#!/usr/bin/env bash
# Readiness: verify gRPC still routes correctly (Caddy Content-Type matcher → Envoy).
# Uses grpcurl to Caddy :443 with authority off-campus-housing.local; expects grpc.health.v1.Health/Check SERVING.
# Run after Caddy rollout to ensure no accidental downgrade or routing break.
# Requires: grpcurl, cluster with Caddy + Envoy, certs/dev-root.pem or dev-root-ca secret in cluster.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

HOST="${HOST:-off-campus-housing.local}"
PORT="${PORT:-443}"
CA_CERT="${CA_CERT:-$REPO_ROOT/certs/dev-root.pem}"

ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
fail(){ echo "❌ $*" >&2; exit 1; }

if ! command -v grpcurl >/dev/null 2>&1; then
  warn "grpcurl not found; skip gRPC routing check (install: brew install grpcurl)"
  exit 0
fi

# Resolve Caddy endpoint: MetalLB LB IP or NodePort
TARGET_IP=""
if [[ -n "${TARGET_IP:-}" ]]; then
  : # use env
elif kubectl get ns ingress-nginx &>/dev/null; then
  TARGET_IP=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
  if [[ -z "$TARGET_IP" ]]; then
    NODEPORT=$(kubectl -n ingress-nginx get svc caddy-h3 -o jsonpath='{.spec.ports[?(@.name=="https")].nodePort}' 2>/dev/null || true)
    [[ -n "$NODEPORT" ]] && PORT="$NODEPORT" && TARGET_IP="127.0.0.1"
  else
    PORT=443
  fi
fi

if [[ -z "$TARGET_IP" ]]; then
  warn "Could not determine Caddy target (set TARGET_IP and PORT); skip gRPC check"
  exit 0
fi

if [[ ! -f "${CA_CERT}" ]] || [[ ! -s "${CA_CERT}" ]]; then
  # Try cluster secret
  CA_CERT=$(mktemp)
  trap 'rm -f "$CA_CERT"' EXIT
  kubectl -n ingress-nginx get secret dev-root-ca -o jsonpath='{.data.dev-root\.pem}' 2>/dev/null | base64 -d > "$CA_CERT" 2>/dev/null || true
  if [[ ! -s "$CA_CERT" ]]; then
    warn "No CA cert (certs/dev-root.pem or dev-root-ca secret); skip gRPC check"
    exit 0
  fi
fi

# gRPC health via Caddy (Content-Type: application/grpc → Envoy)
OUT=$(grpcurl -cacert "$CA_CERT" -authority "$HOST" -max-time 10 -d '{}' "${TARGET_IP}:${PORT}" grpc.health.v1.Health/Check 2>&1) || true
if echo "$OUT" | grep -qE '"status":"SERVING"|SERVING'; then
  ok "gRPC routing OK (Caddy → Envoy; Content-Type matcher)"
  exit 0
fi
if echo "$OUT" | grep -qE "connection refused|context deadline exceeded|no such host"; then
  fail "gRPC routing failed: Caddy/Envoy unreachable ($OUT)"
fi
fail "gRPC routing failed: expected SERVING, got ($OUT)"
