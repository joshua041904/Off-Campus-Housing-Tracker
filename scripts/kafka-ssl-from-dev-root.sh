#!/usr/bin/env bash
# Create Kafka broker keystore/truststore and kafka-ssl-secret using dev-root-ca (same CA as Caddy).
# Run after reissue (certs/dev-root.pem and certs/dev-root.key must exist).
# Output: certs/kafka-ssl/*.jks, *.p12, passwords; creates kafka-ssl-secret in record-platform
#   with ca-cert.pem (dev-root), keystore, truststore for Docker Kafka SSL and Node clients.
#
# Usage: ./scripts/kafka-ssl-from-dev-root.sh
#   KAFKA_SSL_NS=record-platform  — namespace for kafka-ssl-secret
#   KAFKA_SSL_PASS=changeit       — keystore/truststore password

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="${SCRIPT_DIR}/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

NS="${KAFKA_SSL_NS:-record-platform}"
PASS="${KAFKA_SSL_PASS:-changeit}"
CA_PEM="${REPO_ROOT}/certs/dev-root.pem"
CA_KEY="${REPO_ROOT}/certs/dev-root.key"
OUT="${REPO_ROOT}/certs/kafka-ssl"
TMP="${REPO_ROOT}/.kafka-ssl-tmp.$$"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }

say "=== Kafka SSL from dev-root-ca (strict TLS, same CA as Caddy) ==="

command -v openssl >/dev/null 2>&1 || { echo "❌ openssl required"; exit 1; }
command -v keytool >/dev/null 2>&1 || { echo "❌ keytool required (brew install openjdk)"; exit 1; }

ctx=$(kubectl config current-context 2>/dev/null || echo "")
kctl() {
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1; then
    colima ssh -- kubectl --request-timeout=15s "$@" 2>/dev/null || colima ssh -- kubectl --request-timeout=15s "$@"
  else
    kubectl --request-timeout=15s "$@" 2>/dev/null || kubectl --request-timeout=15s "$@"
  fi
}

if [[ ! -f "$CA_PEM" ]] || [[ ! -f "$CA_KEY" ]]; then
  echo "❌ dev-root CA not found. Run: pnpm run reissue (with KAFKA_SSL=1 to persist CA key), or ensure certs/dev-root.pem and certs/dev-root.key exist."
  exit 1
fi

mkdir -p "$OUT" "$TMP"
trap 'rm -rf "$TMP"' EXIT
# Remove existing keystore/truststore so keytool never sees "alias already exists"
rm -f "$OUT/kafka.keystore.jks" "$OUT/kafka.truststore.jks" "$OUT/kafka.keystore-password" "$OUT/kafka.truststore-password" "$OUT/kafka.key-password" 2>/dev/null || true

# SANs for Docker Kafka (host, kafka service, localhost)
# Include 192.168.5.1 (host IP for Colima/Docker) to fix "IP does not match certificate's altnames" errors
KAFKA_SANS="DNS:kafka,DNS:localhost,DNS:host.docker.internal,DNS:kafka-external.record-platform.svc.cluster.local,IP:127.0.0.1,IP:192.168.5.1"
CN="${KAFKA_SSL_CN:-kafka}"

say "1. Generating Kafka broker key and CSR..."
openssl genrsa -out "$TMP/kafka.key" 2048 2>/dev/null
openssl req -new -key "$TMP/kafka.key" -out "$TMP/kafka.csr" \
  -subj "/CN=${CN}/O=record-platform" 2>/dev/null

cat > "$TMP/san.ext" <<EOF
[v3_req]
subjectAltName = $KAFKA_SANS
extendedKeyUsage = serverAuth
keyUsage = digitalSignature, keyEncipherment
EOF

say "2. Signing broker cert with dev-root-ca..."
openssl x509 -req -in "$TMP/kafka.csr" -CA "$CA_PEM" -CAkey "$CA_KEY" \
  -CAcreateserial -out "$TMP/kafka.pem" -days 365 \
  -extensions v3_req -extfile "$TMP/san.ext" 2>/dev/null
ok "Broker cert signed"

say "3. Creating JKS keystore and truststore..."
openssl pkcs12 -export -in "$TMP/kafka.pem" -inkey "$TMP/kafka.key" \
  -out "$TMP/kafka.p12" -passout "pass:$PASS" -name kafka 2>/dev/null
keytool -importkeystore -srckeystore "$TMP/kafka.p12" -srcstoretype PKCS12 \
  -srcstorepass "$PASS" -destkeystore "$OUT/kafka.keystore.jks" \
  -deststoretype JKS -deststorepass "$PASS" -noprompt 2>/dev/null

keytool -importcert -alias dev-root-ca -file "$CA_PEM" \
  -keystore "$OUT/kafka.truststore.jks" -storepass "$PASS" -noprompt 2>/dev/null

echo -n "$PASS" > "$OUT/kafka.keystore-password"
echo -n "$PASS" > "$OUT/kafka.truststore-password"
echo -n "$PASS" > "$OUT/kafka.key-password"  # KAFKA_SSL_KEY_CREDENTIALS (in-cluster Kafka deploy)
cp "$CA_PEM" "$OUT/ca-cert.pem"
ok "Keystore/truststore and ca-cert.pem in $OUT"

say "4. Creating kafka-ssl-secret in $NS..."
kctl create namespace "$NS" 2>/dev/null || true
# Use a temp file so apply works with host kubectl (pipe to colima ssh often yields "no objects passed to apply")
_kafka_secret_yaml="${TMP}/kafka-ssl-secret.yaml"
kubectl create secret generic kafka-ssl-secret -n "$NS" \
  --from-file=kafka.keystore.jks="$OUT/kafka.keystore.jks" \
  --from-file=kafka.truststore.jks="$OUT/kafka.truststore.jks" \
  --from-file=kafka.keystore-password="$OUT/kafka.keystore-password" \
  --from-file=kafka.truststore-password="$OUT/kafka.truststore-password" \
  --from-file=kafka.key-password="$OUT/kafka.key-password" \
  --from-file=ca-cert.pem="$OUT/ca-cert.pem" \
  --from-file=ca.crt="$OUT/ca-cert.pem" \
  --dry-run=client -o yaml >"$_kafka_secret_yaml"
if ! kubectl apply -f "$_kafka_secret_yaml" --request-timeout=20s 2>/dev/null; then
  # After reissue the host tunnel is often down; try in-VM apply (repo path usually same in Colima)
  if [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1 && [[ -f "$_kafka_secret_yaml" ]]; then
    if colima ssh -- env KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl apply -f "$_kafka_secret_yaml" --request-timeout=20s 2>/dev/null; then
      ok "kafka-ssl-secret created/updated (via colima ssh)"
    else
      warn "kubectl apply failed (host and colima ssh). Check cluster reachable and namespace $NS"
      exit 1
    fi
  else
    warn "kubectl apply failed (check cluster reachable and namespace $NS)"
    exit 1
  fi
else
  ok "kafka-ssl-secret created/updated"
fi

say "=== Kafka SSL (dev-root-ca) done ==="
echo "  Keystore/truststore: $OUT. Docker Kafka: mount $OUT, use SSL listener 9093."
echo "  Clients: KAFKA_CA_CERT=/etc/kafka/secrets/ca-cert.pem, KAFKA_USE_SSL=true."
