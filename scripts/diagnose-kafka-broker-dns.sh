#!/usr/bin/env bash
# Diagnose "getaddrinfo ENOTFOUND kafka-0.kafka.<ns>.svc.cluster.local" (analytics / any KafkaJS client).
# Root causes: headless Service `kafka` missing, StatefulSet pods not Ready, stale EndpointSlices, wrong namespace.
#
# Usage: HOUSING_NS=off-campus-housing-tracker ./scripts/diagnose-kafka-broker-dns.sh
# Remediation hints: make verify-kafka-dns, make kafka-onboarding-reset && make apply-kafka-kraft, validate-kafka-dns.sh
set -euo pipefail

NS="${HOUSING_NS:-off-campus-housing-tracker}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*" >&2; }
bad() { echo "  ❌ $*" >&2; }

say "Kafka broker DNS diagnostic (namespace=$NS)"

if ! command -v kubectl >/dev/null 2>&1; then
  bad "kubectl not in PATH"
  exit 1
fi

if ! kubectl get ns "$NS" --request-timeout=15s >/dev/null 2>&1; then
  bad "Namespace $NS not found — set HOUSING_NS or create namespace"
  exit 1
fi
ok "Namespace exists"

if ! kubectl get svc kafka -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
  bad "Service/kafka (headless) missing — apply infra/k8s/kafka-kraft-metallb/headless-service.yaml (see make apply-kafka-kraft)"
  exit 1
fi
cluster_ip="$(kubectl get svc kafka -n "$NS" -o jsonpath='{.spec.clusterIP}' --request-timeout=15s)"
if [[ "$cluster_ip" != "None" ]]; then
  bad "Service/kafka is not headless (clusterIP should be None; got $cluster_ip)"
  exit 1
fi
ok "Headless Service/kafka exists (clusterIP=None)"

if ! kubectl get sts kafka -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
  bad "StatefulSet/kafka missing — brokers never created"
  exit 1
fi
ok "StatefulSet/kafka exists"

fail_pods=0
for i in 0 1 2; do
  pod="kafka-$i"
  if ! kubectl get pod "$pod" -n "$NS" --request-timeout=15s >/dev/null 2>&1; then
    bad "Pod $pod not found"
    fail_pods=1
    continue
  fi
  phase="$(kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.phase}' --request-timeout=15s)"
  ready="$(kubectl get pod "$pod" -n "$NS" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' --request-timeout=15s)"
  echo "  Pod $pod: phase=$phase Ready=$ready"
  if [[ "$phase" != "Running" || "$ready" != "True" ]]; then
    bad "$pod not Running/Ready — DNS will not resolve stable broker names"
    fail_pods=1
  fi
done

if [[ "$fail_pods" -ne 0 ]]; then
  say "Remediation (pods unhealthy)"
  echo "  kubectl describe pod kafka-0 -n $NS"
  echo "  kubectl logs kafka-0 -n $NS -c kafka --tail=80"
  echo "  make kafka-tls-guard   # JKS / TLS drift"
  echo "  make apply-kafka-kraft # re-apply KRaft + external svcs"
  exit 1
fi
ok "Broker pods kafka-0..2 exist"

fqdn="kafka-0.kafka.${NS}.svc.cluster.local"
say "In-cluster FQDN (expect A record when headless Endpoints are healthy): $fqdn"
echo "  From a Running pod in $NS, run:"
echo "    getent hosts $fqdn || nslookup $fqdn"
echo "  NXDOMAIN / no answer → CoreDNS cannot see EndpointSlices for Service/kafka (stale slices or pods not Ready)."

say "EndpointSlice vs pod IP (stale slices → wrong A records)"
if [[ -x "$SCRIPT_DIR/validate-kafka-dns.sh" ]]; then
  KAFKA_NAMESPACE="$NS" bash "$SCRIPT_DIR/validate-kafka-dns.sh" && ok "validate-kafka-dns.sh passed" || {
    bad "validate-kafka-dns.sh failed — fix slices / rollout kafka"
    echo "  kubectl get endpointslice -n $NS -l kubernetes.io/service-name=kafka"
    echo "  See scripts/validate-kafka-dns.sh hints"
    exit 1
  }
else
  warn "validate-kafka-dns.sh not executable — chmod +x scripts/validate-kafka-dns.sh"
fi

say "App-config bootstrap string (should list kafka-0..2 :9093 internal TLS)"
if kubectl get configmap app-config -n "$NS" -o yaml --request-timeout=15s 2>/dev/null | grep -E "KAFKA|kafka" | head -15; then
  ok "app-config snippet above"
else
  warn "configmap app-config not found or empty Kafka keys"
fi

echo ""
ok "Diagnostic complete — if ENOTFOUND persists: ensure headless kafka Service + Ready kafka-0..2 + EndpointSlices match pod IPs"
