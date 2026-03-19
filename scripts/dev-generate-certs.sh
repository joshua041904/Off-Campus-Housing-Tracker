#!/usr/bin/env bash
# Generate dev CA and leaf certs for local dev (no k3s). Required for strict TLS/mTLS.
# Output: certs/dev-root.pem, certs/dev-root.key; certs/off-campus-housing.local.{crt,key} (Caddy/ingress);
#         certs/messaging-service.{crt,key}; certs/media-service.{crt,key};
#         certs/kafka-dev/ca.pem, client.crt, client.key (Node clients); certs/kafka-ssl/ (JKS for broker if keytool available).
#
# Usage: ./scripts/dev-generate-certs.sh
# Prereq: openssl. Optional: keytool (for Kafka broker JKS).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

CERTS="$REPO_ROOT/certs"
KAFKA_DEV="$CERTS/kafka-dev"
KAFKA_SSL="$CERTS/kafka-ssl"
TMP="${REPO_ROOT}/.dev-certs-tmp.$$"
DAYS=365

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

command -v openssl >/dev/null 2>&1 || { echo "❌ openssl required"; exit 1; }

mkdir -p "$CERTS" "$KAFKA_DEV" "$TMP"
trap 'rm -rf "$TMP"' EXIT

say "=== Dev certs (strict TLS, no plaintext) ==="

# 1. Dev CA
if [[ ! -f "$CERTS/dev-root.pem" ]] || [[ ! -f "$CERTS/dev-root.key" ]]; then
  say "1. Creating dev CA (dev-root.pem, dev-root.key)..."
  openssl genrsa -out "$CERTS/dev-root.key" 2048 2>/dev/null
  openssl req -x509 -new -nodes -key "$CERTS/dev-root.key" -sha256 -days "$DAYS" \
    -out "$CERTS/dev-root.pem" -subj "/CN=dev-root-ca/O=off-campus-housing-dev" 2>/dev/null
  ok "Dev CA created"
else
  ok "Dev CA already exists"
fi

CA_PEM="$CERTS/dev-root.pem"
CA_KEY="$CERTS/dev-root.key"

# 2. Caddy/ingress leaf (off-campus-housing.local) — required for strict-tls-bootstrap.sh and rollout-caddy.sh
say "2. Creating Caddy leaf (off-campus-housing.local)..."
HOST="${HOST:-off-campus-housing.local}"
if [[ ! -f "$CERTS/off-campus-housing.local.crt" ]] || [[ ! -f "$CERTS/off-campus-housing.local.key" ]]; then
  openssl genrsa -out "$CERTS/off-campus-housing.local.key" 2048 2>/dev/null
  openssl req -new -key "$CERTS/off-campus-housing.local.key" -out "$TMP/leaf.csr" \
    -subj "/CN=${HOST}/O=off-campus-housing-tracker" 2>/dev/null
  SANS="DNS:${HOST},DNS:*.${HOST},DNS:localhost,DNS:caddy-h3.ingress-nginx.svc.cluster.local,IP:127.0.0.1,IP:::1"
  echo "[v3_req]
subjectAltName=$SANS" > "$TMP/ext.conf"
  openssl x509 -req -in "$TMP/leaf.csr" -CA "$CA_PEM" -CAkey "$CA_KEY" \
    -CAcreateserial -out "$CERTS/off-campus-housing.local.crt" -days "$DAYS" \
    -extensions v3_req -extfile "$TMP/ext.conf" 2>/dev/null
  ok "off-campus-housing.local.crt, .key (for Caddy TLS)"
else
  ok "off-campus-housing.local.crt|.key already exist"
fi

# 3. messaging-service leaf
say "3. Creating messaging-service leaf..."
openssl genrsa -out "$CERTS/messaging-service.key" 2048 2>/dev/null
openssl req -new -key "$CERTS/messaging-service.key" -out "$TMP/messaging.csr" \
  -subj "/CN=messaging-service/O=off-campus-housing-dev" 2>/dev/null
openssl x509 -req -in "$TMP/messaging.csr" -CA "$CA_PEM" -CAkey "$CA_KEY" -CAcreateserial \
  -out "$CERTS/messaging-service.crt" -days "$DAYS" -sha256 2>/dev/null
ok "messaging-service.crt, .key"

# 4. media-service leaf
say "4. Creating media-service leaf..."
openssl genrsa -out "$CERTS/media-service.key" 2048 2>/dev/null
openssl req -new -key "$CERTS/media-service.key" -out "$TMP/media.csr" \
  -subj "/CN=media-service/O=off-campus-housing-dev" 2>/dev/null
openssl x509 -req -in "$TMP/media.csr" -CA "$CA_PEM" -CAkey "$CA_KEY" \
  -out "$CERTS/media-service.crt" -days "$DAYS" -sha256 2>/dev/null
ok "media-service.crt, .key"

# 5. Kafka client cert (Node: KAFKA_SSL_CA_PATH, KAFKA_SSL_CERT_PATH, KAFKA_SSL_KEY_PATH)
say "5. Creating Kafka client leaf (Node)..."
cp "$CA_PEM" "$KAFKA_DEV/ca.pem"
openssl genrsa -out "$KAFKA_DEV/client.key" 2048 2>/dev/null
openssl req -new -key "$KAFKA_DEV/client.key" -out "$TMP/kafka-client.csr" \
  -subj "/CN=kafka-client/O=off-campus-housing-dev" 2>/dev/null
openssl x509 -req -in "$TMP/kafka-client.csr" -CA "$CA_PEM" -CAkey "$CA_KEY" \
  -out "$KAFKA_DEV/client.crt" -days "$DAYS" -sha256 2>/dev/null
ok "kafka-dev/ca.pem, client.crt, client.key"

# 6. Kafka broker cert (PEM + optional JKS for docker-compose Kafka)
say "6. Creating Kafka broker cert..."
KAFKA_SANS="DNS:kafka,DNS:localhost,DNS:host.docker.internal,IP:127.0.0.1,IP:192.168.5.1"
openssl genrsa -out "$TMP/kafka-broker.key" 2048 2>/dev/null
openssl req -new -key "$TMP/kafka-broker.key" -out "$TMP/kafka-broker.csr" \
  -subj "/CN=kafka/O=off-campus-housing-dev" 2>/dev/null
cat > "$TMP/san.ext" <<EOF
[v3_req]
subjectAltName = $KAFKA_SANS
extendedKeyUsage = serverAuth
keyUsage = digitalSignature, keyEncipherment
EOF
openssl x509 -req -in "$TMP/kafka-broker.csr" -CA "$CA_PEM" -CAkey "$CA_KEY" \
  -CAcreateserial -out "$TMP/kafka-broker.crt" -days "$DAYS" -extensions v3_req -extfile "$TMP/san.ext" 2>/dev/null

mkdir -p "$KAFKA_SSL"
cp "$CA_PEM" "$KAFKA_SSL/ca-cert.pem"
cp "$TMP/kafka-broker.crt" "$KAFKA_SSL/kafka-broker.crt"
cp "$TMP/kafka-broker.key" "$KAFKA_SSL/kafka-broker.key"

if command -v keytool >/dev/null 2>&1; then
  PASS="${KAFKA_SSL_PASS:-changeit}"
  openssl pkcs12 -export -in "$TMP/kafka-broker.crt" -inkey "$TMP/kafka-broker.key" \
    -out "$TMP/kafka.p12" -passout "pass:$PASS" -name kafka 2>/dev/null
  keytool -importkeystore -srckeystore "$TMP/kafka.p12" -srcstoretype PKCS12 -srcstorepass "$PASS" \
    -destkeystore "$KAFKA_SSL/kafka.keystore.jks" -deststoretype JKS -deststorepass "$PASS" -noprompt 2>/dev/null
  keytool -importcert -alias dev-root-ca -file "$CA_PEM" -keystore "$KAFKA_SSL/kafka.truststore.jks" -storepass "$PASS" -noprompt 2>/dev/null || true
  echo -n "$PASS" > "$KAFKA_SSL/kafka.keystore-password"
  echo -n "$PASS" > "$KAFKA_SSL/kafka.truststore-password"
  echo -n "$PASS" > "$KAFKA_SSL/kafka.key-password"
  ok "Kafka broker JKS in certs/kafka-ssl/"
else
  warn "keytool not found; Kafka broker needs JKS. Run: brew install openjdk, then re-run this script or scripts/kafka-ssl-from-dev-root.sh"
fi

say "=== Dev certs done ==="
echo "  CA: certs/dev-root.pem, certs/dev-root.key"
echo "  Caddy/ingress: certs/off-campus-housing.local.crt, certs/off-campus-housing.local.key"
echo "  Services: certs/messaging-service.{crt,key}, certs/media-service.{crt,key}"
echo "  Kafka client (Node): certs/kafka-dev/ca.pem, client.crt, client.key"
echo "  Kafka broker: certs/kafka-ssl/ (use with docker-compose Kafka TLS)"
echo "  No plaintext Kafka. Set KAFKA_SSL_ENABLED=true and cert paths for clients."
