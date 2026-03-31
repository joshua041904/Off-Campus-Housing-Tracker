#!/usr/bin/env bash
# Ephemeral CA + broker + client material for CI (GitHub Actions): strict TLS + mTLS-compatible EKU.
# Writes certs/kafka-ssl-ci/ (gitignored under certs/**) — same layout as kafka-ssl-from-dev-root.sh.
#
# Broker cert: extendedKeyUsage = serverAuth, clientAuth (Kafka JVM may act as TLS client).
# Client cert: extendedKeyUsage = clientAuth
#
# Usage: from repo root — bash scripts/ci/generate-kafka-ci-tls.sh
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

command -v openssl >/dev/null 2>&1 || { echo "openssl required"; exit 1; }
command -v keytool >/dev/null 2>&1 || { echo "keytool required (install openjdk)"; exit 1; }

PASS="${KAFKA_CI_TLS_PASS:-changeit}"
OUT="${REPO_ROOT}/certs/kafka-ssl-ci"
TMP="${REPO_ROOT}/.kafka-ci-tls-tmp.$$"
mkdir -p "$OUT" "$TMP"
trap 'rm -rf "$TMP"' EXIT

rm -f "$OUT"/* 2>/dev/null || true

# Ephemeral CI CA (7 days)
openssl genrsa -out "$TMP/ca.key" 2048
openssl req -x509 -new -nodes -key "$TMP/ca.key" -sha256 -days 7 \
  -subj "/CN=och-kafka-ci-ca/O=off-campus-housing-ci" \
  -out "$TMP/ca.pem"

KAFKA_SANS="DNS:kafka,DNS:localhost,DNS:host.docker.internal,IP:127.0.0.1"
CN="${KAFKA_CI_BROKER_CN:-kafka}"

openssl genrsa -out "$TMP/kafka.key" 2048
openssl req -new -key "$TMP/kafka.key" -out "$TMP/kafka.csr" \
  -subj "/CN=${CN}/O=och-kafka-ci"

cat > "$TMP/broker.ext" <<EOF
[kafka_broker_tls]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectAltName = $KAFKA_SANS
EOF

if ! openssl x509 -req -in "$TMP/kafka.csr" -CA "$TMP/ca.pem" -CAkey "$TMP/ca.key" \
  -CAcreateserial -out "$TMP/kafka.pem" -days 7 \
  -extensions kafka_broker_tls -extfile "$TMP/broker.ext"; then
  echo "❌ CI broker cert sign failed"
  exit 1
fi
if ! openssl x509 -in "$TMP/kafka.pem" -text -noout | grep -A2 "Extended Key Usage" | grep -q "TLS Web Client Authentication"; then
  echo "❌ CI broker PEM missing clientAuth EKU"
  exit 1
fi

openssl genrsa -out "$TMP/client.key" 2048
openssl req -new -key "$TMP/client.key" -out "$TMP/client.csr" \
  -subj "/CN=kafka-client/O=och-kafka-ci"

cat > "$TMP/client.ext" <<EOF
[v3_client]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
EOF

openssl x509 -req -in "$TMP/client.csr" -CA "$TMP/ca.pem" -CAkey "$TMP/ca.key" \
  -CAcreateserial -out "$TMP/client.crt" -days 7 -sha256 \
  -extensions v3_client -extfile "$TMP/client.ext"

openssl pkcs12 -export -in "$TMP/kafka.pem" -inkey "$TMP/kafka.key" \
  -out "$TMP/kafka.p12" -passout "pass:$PASS" -name kafka
keytool -importkeystore -srckeystore "$TMP/kafka.p12" -srcstoretype PKCS12 \
  -srcstorepass "$PASS" -destkeystore "$OUT/kafka.keystore.jks" \
  -deststoretype JKS -deststorepass "$PASS" -noprompt

keytool -importcert -alias ci-ca -file "$TMP/ca.pem" \
  -keystore "$OUT/kafka.truststore.jks" -storepass "$PASS" -noprompt

cp "$TMP/ca.pem" "$OUT/ca-cert.pem"
cp "$TMP/client.crt" "$OUT/client.crt"
cp "$TMP/client.key" "$OUT/client.key"

echo -n "$PASS" > "$OUT/kafka.keystore-password"
echo -n "$PASS" > "$OUT/kafka.truststore-password"
echo -n "$PASS" > "$OUT/kafka.key-password"

chmod +x "$REPO_ROOT/scripts/verify-kafka-broker-keystore-jks.sh" 2>/dev/null || true
KAFKA_KEYSTORE_PATH="$OUT/kafka.keystore.jks" \
  KAFKA_KEYSTORE_PASSWORD_FILE="$OUT/kafka.keystore-password" \
  REPO_ROOT="$REPO_ROOT" \
  bash "$REPO_ROOT/scripts/verify-kafka-broker-keystore-jks.sh" || exit 1

echo "Kafka CI TLS material written to $OUT (broker EKU serverAuth+clientAuth; client EKU clientAuth)."
