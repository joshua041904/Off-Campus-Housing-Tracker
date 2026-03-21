#!/usr/bin/env bash
# Ensure housing namespace has TLS + Kafka secrets expected by Deployments:
#   - service-tls + dev-root-ca (strict TLS) via ensure-strict-tls-mtls-preflight.sh when missing/incomplete
#   - och-service-tls — alias of service-tls (same ca.crt / tls.crt / tls.key)
#   - och-kafka-ssl-secret — from kafka-ssl-secret or by running kafka-ssl-from-dev-root.sh when CA key exists
#
# Called early from run-preflight-scale-and-all-suites.sh (3a0). Idempotent.
# Skip: PREFLIGHT_AUTO_ENSURE_CLUSTER_SECRETS=0 or SKIP_AUTO_CLUSTER_SECRETS=1
#
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

# Never use generic NS= from the shell (other repos set NS=record-platform).
HOUSING_NS="${HOUSING_NS:-off-campus-housing-tracker}"
NS="$HOUSING_NS"
CERTS_DIR="$REPO_ROOT/certs"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "  ✅ $*"; }
warn() { echo "  ⚠️  $*"; }

if ! kubectl get ns "$NS" -o name &>/dev/null; then
  warn "Namespace $NS missing — creating it (run kustomize/deploy for full stack)"
  kubectl create namespace "$NS" --dry-run=client -o yaml | kubectl apply -f - --request-timeout=20s
fi

_ensure_och_service_tls_alias() {
  if ! kubectl -n "$NS" get secret service-tls -o name &>/dev/null; then
    warn "Cannot sync och-service-tls: service-tls missing"
    return 1
  fi
  local d
  d=$(mktemp -d)
  kubectl -n "$NS" get secret service-tls -o jsonpath='{.data.ca\.crt}' | base64 -d >"$d/ca.crt"
  kubectl -n "$NS" get secret service-tls -o jsonpath='{.data.tls\.crt}' | base64 -d >"$d/tls.crt"
  kubectl -n "$NS" get secret service-tls -o jsonpath='{.data.tls\.key}' | base64 -d >"$d/tls.key"
  kubectl -n "$NS" create secret generic och-service-tls \
    --from-file=ca.crt="$d/ca.crt" \
    --from-file=tls.crt="$d/tls.crt" \
    --from-file=tls.key="$d/tls.key" \
    --dry-run=client -o yaml | kubectl apply -f - --request-timeout=20s
  rm -rf "$d"
  ok "och-service-tls synced from service-tls"
}

_ensure_och_kafka_ssl_secret() {
  if kubectl -n "$NS" get secret kafka-ssl-secret -o name &>/dev/null; then
    local d
    d=$(mktemp -d)
    _kf_extract() {
      python3 -c "
import json, base64, subprocess, sys
ns = sys.argv[1]
key = sys.argv[2]
path = sys.argv[3]
r = subprocess.run(
    ['kubectl', '-n', ns, 'get', 'secret', 'kafka-ssl-secret', '-o', 'json'],
    capture_output=True,
    text=True,
)
r.check_returncode()
data = json.loads(r.stdout).get('data') or {}
if key not in data:
    sys.exit(2)
open(path, 'wb').write(base64.b64decode(data[key]))
" "$NS" "$1" "$2" 2>/dev/null
    }
    if _kf_extract ca-cert.pem "$d/ca-cert.pem" && _kf_extract client.crt "$d/client.crt" && _kf_extract client.key "$d/client.key"; then
      kubectl -n "$NS" create secret generic och-kafka-ssl-secret \
        --from-file=ca-cert.pem="$d/ca-cert.pem" \
        --from-file=client.crt="$d/client.crt" \
        --from-file=client.key="$d/client.key" \
        --dry-run=client -o yaml | kubectl apply -f - --request-timeout=20s
      rm -rf "$d"
      ok "och-kafka-ssl-secret synced from kafka-ssl-secret"
      return 0
    fi
    rm -rf "$d"
    warn "kafka-ssl-secret missing ca-cert.pem / client.crt / client.key; cannot sync och-kafka-ssl-secret"
  fi
  if [[ -f "$CERTS_DIR/dev-root.pem" ]] && [[ -f "$CERTS_DIR/dev-root.key" ]] && [[ -x "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" ]]; then
    KAFKA_SSL_NS="$NS" "$SCRIPT_DIR/kafka-ssl-from-dev-root.sh" && ok "Kafka SSL secrets (kafka + och) refreshed" || warn "kafka-ssl-from-dev-root.sh failed"
  else
    warn "No kafka-ssl-secret / och-kafka-ssl-secret and no certs/dev-root.{pem,key} — run reissue (KAFKA_SSL=1) then: ./scripts/kafka-ssl-from-dev-root.sh"
  fi
}

say "ensure-housing-cluster-secrets (namespace=$NS)"

need_strict=0
if ! kubectl -n "$NS" get secret service-tls -o name &>/dev/null; then
  need_strict=1
elif ! kubectl -n "$NS" get secret dev-root-ca -o name &>/dev/null; then
  need_strict=1
fi

if [[ "$need_strict" -eq 1 ]] && [[ -f "$SCRIPT_DIR/ensure-strict-tls-mtls-preflight.sh" ]]; then
  chmod +x "$SCRIPT_DIR/ensure-strict-tls-mtls-preflight.sh" 2>/dev/null || true
  if FORCE_TLS_RESTART="${FORCE_TLS_RESTART:-0}" HOUSING_NS="$HOUSING_NS" "$SCRIPT_DIR/ensure-strict-tls-mtls-preflight.sh"; then
    ok "Strict TLS/mTLS preflight provisioned missing secrets"
  else
    warn "ensure-strict-tls-mtls-preflight failed (install mkcert or add certs/*.pem); continuing with alias steps"
  fi
else
  ok "service-tls + dev-root-ca present (skip strict provision)"
fi

_ensure_och_service_tls_alias || true
_ensure_och_kafka_ssl_secret || true

say "ensure-housing-cluster-secrets done"
