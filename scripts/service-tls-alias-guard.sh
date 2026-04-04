#!/usr/bin/env bash
# Fail if service-tls and och-service-tls ca.crt fingerprints differ (mTLS drift: api-gateway vs auth, etc.).
#
# Env: HOUSING_NS — default off-campus-housing-tracker
#      SERVICE_TLS_ALIAS_GUARD_SKIP=1 — no-op success
set -euo pipefail

NS="${HOUSING_NS:-off-campus-housing-tracker}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
bad() { echo "❌ $*" >&2; }

if [[ "${SERVICE_TLS_ALIAS_GUARD_SKIP:-0}" == "1" ]]; then
  say "=== service-tls-alias-guard (skipped) ==="
  exit 0
fi

command -v kubectl >/dev/null 2>&1 || { echo "❌ kubectl required"; exit 1; }
command -v openssl >/dev/null 2>&1 || { echo "❌ openssl required"; exit 1; }

_fp() {
  openssl x509 -noout -fingerprint -sha256 2>/dev/null | cut -d= -f2
}

say "=== service-tls-alias-guard (ns=$NS) ==="

for s in service-tls och-service-tls; do
  if ! kubectl get secret "$s" -n "$NS" --request-timeout=20s >/dev/null 2>&1; then
    bad "Secret $s missing in $NS (run: make tls-first-time or scripts/ensure-housing-cluster-secrets.sh)"
    exit 1
  fi
done

_a="$(kubectl get secret service-tls -n "$NS" -o jsonpath='{.data.ca\.crt}' --request-timeout=20s | base64 -d | _fp)"
_b="$(kubectl get secret och-service-tls -n "$NS" -o jsonpath='{.data.ca\.crt}' --request-timeout=20s | base64 -d | _fp)"

if [[ -z "$_a" || -z "$_b" ]]; then
  bad "Could not read ca.crt from service-tls and/or och-service-tls"
  exit 1
fi

echo "   service-tls     ca.crt SHA-256=$_a"
echo "   och-service-tls ca.crt SHA-256=$_b"

if [[ "$_a" != "$_b" ]]; then
  bad "CA fingerprint mismatch — run: HOUSING_NS=$NS bash scripts/ensure-housing-cluster-secrets.sh"
  exit 1
fi

ok "service-tls and och-service-tls ca.crt match"
