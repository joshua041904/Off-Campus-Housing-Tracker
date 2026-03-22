#!/usr/bin/env bash
# Generate a dedicated Envoy client cert (CN=envoy) signed by dev-root for strict mTLS.
# Backends expect a client identity; the edge leaf (off-campus-housing.test) is not a service identity.
# Run from repo root. Requires: certs/dev-root.pem, certs/dev-root.key (run reissue with KAFKA_SSL=1 to persist CA key).
#
# Output: certs/envoy-client.crt, certs/envoy-client.key
# Use in envoy-test as secret envoy-client-tls (envoy.crt, envoy.key) so Envoy presents this cert to backends.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

CA_CRT="${CA_CRT:-certs/dev-root.pem}"
CA_KEY="${CA_KEY:-certs/dev-root.key}"
OUT_CRT="${OUT_CRT:-certs/envoy-client.crt}"
OUT_KEY="${OUT_KEY:-certs/envoy-client.key}"

if [[ ! -f "$CA_CRT" ]]; then
  echo "❌ CA cert not found: $CA_CRT. Run reissue or ensure certs/ exists." >&2
  exit 1
fi
if [[ ! -f "$CA_KEY" ]]; then
  echo "❌ CA key not found: $CA_KEY. Run: KAFKA_SSL=1 ./scripts/reissue-ca-and-leaf-load-all-services.sh (persists dev-root.key)." >&2
  exit 1
fi

mkdir -p certs
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# CN=envoy, SAN for Envoy identity (service name / FQDN)
openssl genrsa -out "$TMP/envoy.key" 2048 2>/dev/null
openssl req -new -key "$TMP/envoy.key" -out "$TMP/envoy.csr" \
  -subj "/CN=envoy/O=off-campus-housing-tracker" 2>/dev/null

cat > "$TMP/ext.conf" <<'EXT'
[v3_req]
subjectAltName=DNS:envoy,DNS:envoy-test.envoy-test.svc.cluster.local
EXT

openssl x509 -req -in "$TMP/envoy.csr" -CA "$CA_CRT" -CAkey "$CA_KEY" \
  -CAcreateserial -out "$TMP/envoy.crt" -days 365 \
  -extensions v3_req -extfile "$TMP/ext.conf" 2>/dev/null

cp "$TMP/envoy.crt" "$OUT_CRT"
cp "$TMP/envoy.key" "$OUT_KEY"
chmod 600 "$OUT_KEY" 2>/dev/null || true

echo "✅ Envoy client cert: $OUT_CRT, $OUT_KEY (CN=envoy, SAN: envoy, envoy-test.envoy-test.svc.cluster.local)"
