#!/usr/bin/env bash
# Ephemeral cluster smoke: MetalLB + trivial LoadBalancer Service (GitHub Actions k3s or any reachable cluster).
# Does not run full dev-onboard. Requires kubectl pointing at a cluster with one Ready node.
#
# Env:
#   METALLB_POOL — optional range e.g. 10.0.0.200-10.0.0.210 (default: derived from node InternalIP /24)
#   EPHEMERAL_SKIP_LB_TEST=1 — install MetalLB + pool only
#   METALLB_MANIFEST_URL — override MetalLB install manifest
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
METALLB_MANIFEST_URL="${METALLB_MANIFEST_URL:-https://raw.githubusercontent.com/metallb/metallb/v0.14.3/config/manifests/metallb-native.yaml}"
MAX_RETRIES="${MAX_RETRIES:-36}"
RETRY_SLEEP="${RETRY_SLEEP:-5}"
POOL_NAME="${POOL_NAME:-off-campus-housing-tracker-pool}"

ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*" >&2; }
fail() { echo "❌ $*" >&2; exit 1; }

command -v kubectl >/dev/null 2>&1 || fail "kubectl required"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

say "=== ephemeral-k3s-converge (CI_MODE=${CI_MODE:-0}) ==="

say "Waiting for API..."
for i in $(seq 1 "$MAX_RETRIES"); do
  if kubectl get ns default --request-timeout=10s >/dev/null 2>&1; then
    ok "API ready"
    break
  fi
  [[ $i -eq "$MAX_RETRIES" ]] && fail "Kubernetes API not ready"
  sleep "$RETRY_SLEEP"
done

kubectl get nodes -o wide --request-timeout=15s || true

if [[ -z "${METALLB_POOL:-}" ]]; then
  ni=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || true)
  [[ -z "$ni" ]] && fail "Could not read node InternalIP; set METALLB_POOL explicitly"
  IFS=. read -r o1 o2 o3 o4 <<< "$ni"
  METALLB_POOL="${o1}.${o2}.${o3}.200-${o1}.${o2}.${o3}.210"
  ok "Derived METALLB_POOL=$METALLB_POOL from node $ni"
fi

say "Applying MetalLB..."
if ! kubectl apply -f "$METALLB_MANIFEST_URL" --request-timeout=120s 2>/dev/null; then
  curl -fsSL "$METALLB_MANIFEST_URL" | kubectl apply -f - --request-timeout=120s
fi

say "Waiting for MetalLB controller..."
for i in $(seq 1 "$MAX_RETRIES"); do
  if kubectl get deployment controller -n metallb-system --request-timeout=10s >/dev/null 2>&1; then
    if kubectl rollout status deployment/controller -n metallb-system --timeout=120s 2>/dev/null; then
      ok "MetalLB controller ready"
      break
    fi
  fi
  [[ $i -eq "$MAX_RETRIES" ]] && fail "MetalLB controller not ready"
  sleep "$RETRY_SLEEP"
done

for i in $(seq 1 15); do
  if kubectl get endpoints webhook-service -n metallb-system --request-timeout=5s 2>/dev/null | grep -qE '[0-9]'; then
    ok "MetalLB webhook endpoints present"
    break
  fi
  sleep 4
done

_pool_tmp=$(mktemp)
trap 'rm -f "$_pool_tmp"' EXIT
cat <<POOLYAML >"$_pool_tmp"
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: ${POOL_NAME}
  namespace: metallb-system
spec:
  addresses:
    - ${METALLB_POOL}
POOLYAML
kubectl apply -f "$_pool_tmp" --request-timeout=30s
ok "IPAddressPool $POOL_NAME applied"

L2_FILE="$REPO_ROOT/infra/k8s/metallb/l2advertisement.yaml"
[[ -f "$L2_FILE" ]] || fail "Missing $L2_FILE"
kubectl apply -f "$L2_FILE" --request-timeout=30s
ok "L2Advertisement applied"

if [[ "${EPHEMERAL_SKIP_LB_TEST:-0}" == "1" ]]; then
  ok "EPHEMERAL_SKIP_LB_TEST=1 — skipping LoadBalancer probe"
  exit 0
fi

say "LoadBalancer probe (nginx)..."
kubectl delete svc ephemeral-lb-probe -n default --ignore-not-found --request-timeout=15s 2>/dev/null || true
kubectl delete deployment ephemeral-lb-probe -n default --ignore-not-found --request-timeout=15s 2>/dev/null || true
kubectl create deployment ephemeral-lb-probe --image=nginx:alpine -n default --request-timeout=30s
kubectl rollout status deployment/ephemeral-lb-probe -n default --timeout=120s
kubectl expose deployment ephemeral-lb-probe --port=80 --type=LoadBalancer -n default --name=ephemeral-lb-probe --request-timeout=30s

ext_ip=""
for i in $(seq 1 90); do
  ext_ip=$(kubectl get svc ephemeral-lb-probe -n default -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  if [[ -n "$ext_ip" ]]; then
    ok "LoadBalancer EXTERNAL-IP: $ext_ip"
    break
  fi
  sleep 2
done

kubectl delete svc ephemeral-lb-probe -n default --ignore-not-found --request-timeout=20s 2>/dev/null || true
kubectl delete deployment ephemeral-lb-probe -n default --ignore-not-found --request-timeout=20s 2>/dev/null || true

[[ -n "$ext_ip" ]] || fail "LoadBalancer did not receive an IP (check MetalLB pool vs node subnet)"

ok "ephemeral-k3s-converge complete"
