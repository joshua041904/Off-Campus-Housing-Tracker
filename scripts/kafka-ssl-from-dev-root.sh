#!/usr/bin/env bash
# Create Kafka broker keystore/truststore and kafka-ssl-secret using dev-root-ca (same CA as Caddy).
# Run after reissue (certs/dev-root.pem and certs/dev-root.key must exist).
# Output: certs/kafka-ssl/*.jks, *.p12, passwords; creates kafka-ssl-secret in off-campus-housing-tracker
#   with ca-cert.pem (dev-root), keystore, truststore for Docker Kafka SSL and Node clients.
#
# Usage: ./scripts/kafka-ssl-from-dev-root.sh
#   KAFKA_SSL_NS=off-campus-housing-tracker  — namespace for kafka-ssl-secret
#   KAFKA_SSL_PASS=changeit       — keystore/truststore password
#   KAFKA_BROKER_REPLICAS=3       — SANs for kafka-0..N-1 (headless + external service DNS)
#   KAFKA_SSL_EXTRA_IP_SANS=      — optional manual IPs; merged with auto-discovered LB IPs when auto is on
#   KAFKA_SSL_AUTO_METALLB_IPS=   — default 1: append LB IPs from kubectl get svc kafka-*-external (same ns). Set 0 to disable.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
export PATH="${SCRIPT_DIR}/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"
cd "$REPO_ROOT"

NS="${KAFKA_SSL_NS:-off-campus-housing-tracker}"
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
rm -f "$OUT/kafka.keystore.jks" "$OUT/kafka.truststore.jks" "$OUT/kafka.keystore-password" "$OUT/kafka.truststore-password" "$OUT/kafka.key-password" "$OUT/kafka-broker.pem" 2>/dev/null || true

# SANs: shared broker cert (all pods use one JKS) must list every hostname clients and peers use.
# Includes short names (kafka-0, kafka-0.kafka, …svc, …svc.cluster.local) plus external Service DNS per broker.
build_kafka_subject_alt_names() {
  local ns="$1"
  local replicas="$2"
  local parts=()
  parts+=("DNS:kafka")
  parts+=("DNS:localhost")
  parts+=("DNS:host.docker.internal")
  parts+=("DNS:kafka-external.${ns}.svc.cluster.local")
  local i
  for ((i = 0; i < replicas; i++)); do
    parts+=("DNS:kafka-${i}")
    parts+=("DNS:kafka-${i}.kafka")
    parts+=("DNS:kafka-${i}.kafka.${ns}.svc")
    parts+=("DNS:kafka-${i}.kafka.${ns}.svc.cluster.local")
    parts+=("DNS:kafka-${i}-external.${ns}.svc.cluster.local")
  done
  parts+=("IP:127.0.0.1")
  parts+=("IP:192.168.5.1")
  if [[ -n "${KAFKA_SSL_EXTRA_IP_SANS:-}" ]]; then
    local _ip _trimmed
    IFS=',' read -r -a _extra <<< "${KAFKA_SSL_EXTRA_IP_SANS// /}"
    for _ip in "${_extra[@]}"; do
      _trimmed="${_ip// /}"
      [[ -z "$_trimmed" ]] && continue
      parts+=("IP:${_trimmed}")
    done
  fi
  local IFS=,
  echo "${parts[*]}"
}

REPLICAS="${KAFKA_BROKER_REPLICAS:-3}"
# Default on: KRaft EXTERNAL://<MetalLB>:9094 requires those IPs in the broker cert. Disable with KAFKA_SSL_AUTO_METALLB_IPS=0.
if [[ "${KAFKA_SSL_AUTO_METALLB_IPS:-1}" != "0" ]]; then
  _auto_extra=""
  for ((i = 0; i < REPLICAS; i++)); do
    _ip="$(kctl get svc "kafka-${i}-external" -n "$NS" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)"
    if [[ -n "$_ip" ]] && [[ "$_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
      if [[ -n "$_auto_extra" ]]; then
        _auto_extra="${_auto_extra},${_ip}"
      else
        _auto_extra="${_ip}"
      fi
    fi
  done
  if [[ -n "$_auto_extra" ]]; then
    if [[ -n "${KAFKA_SSL_EXTRA_IP_SANS:-}" ]]; then
      KAFKA_SSL_EXTRA_IP_SANS="${KAFKA_SSL_EXTRA_IP_SANS},${_auto_extra}"
    else
      KAFKA_SSL_EXTRA_IP_SANS="${_auto_extra}"
    fi
    ok "MetalLB: merged kafka-*-external LB IPs into KAFKA_SSL_EXTRA_IP_SANS (${_auto_extra})"
  elif [[ "${KAFKA_SSL_AUTO_METALLB_IPS:-}" == "1" ]]; then
    warn "KAFKA_SSL_AUTO_METALLB_IPS=1 but no kafka-*-external LoadBalancer IPs in namespace ${NS}"
  fi
fi
KAFKA_SANS="$(build_kafka_subject_alt_names "$NS" "$REPLICAS")"
CN="${KAFKA_SSL_CN:-kafka}"
say "Broker TLS SANs: replicas 0..$((REPLICAS - 1)), namespace=${NS} (MetalLB IPs auto-merged when discoverable; KAFKA_SSL_AUTO_METALLB_IPS=0 to skip)"

say "1. Generating Kafka broker key and CSR..."
openssl genrsa -out "$TMP/kafka.key" 2048 2>/dev/null
openssl req -new -key "$TMP/kafka.key" -out "$TMP/kafka.csr" \
  -subj "/CN=${CN}/O=off-campus-housing-tracker" 2>/dev/null

# Broker EKU: serverAuth (listener) + clientAuth (JVM as TLS client for inter-broker SSL, etc.).
# Omitting clientAuth causes: "Extended key usage does not permit use for TLS client authentication".
# Use a dedicated section name (not [v3_req]) so macOS/LibreSSL openssl.cnf [v3_req] defaults cannot override EKU.
cat > "$TMP/san.ext" <<EOF
[kafka_broker_tls]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
subjectAltName = $KAFKA_SANS
EOF

say "2. Signing broker cert with dev-root-ca..."
if ! openssl x509 -req -in "$TMP/kafka.csr" -CA "$CA_PEM" -CAkey "$CA_KEY" \
  -CAcreateserial -out "$TMP/kafka.pem" -days 365 \
  -extensions kafka_broker_tls -extfile "$TMP/san.ext"; then
  echo "❌ openssl x509 broker sign failed (see errors above)"
  exit 1
fi
if ! openssl x509 -in "$TMP/kafka.pem" -text -noout | grep -A2 "Extended Key Usage" | grep -q "TLS Web Client Authentication"; then
  echo "❌ Signed broker cert missing clientAuth EKU (JKS will break Kafka). OpenSSL output:"
  openssl x509 -in "$TMP/kafka.pem" -text -noout | grep -A3 "Extended Key Usage" || true
  exit 1
fi
ok "Broker cert signed (serverAuth + clientAuth in PEM)"
cp "$TMP/kafka.pem" "$OUT/kafka-broker.pem"

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

chmod +x "$SCRIPT_DIR/verify-kafka-broker-keystore-jks.sh" 2>/dev/null || true
KAFKA_KEYSTORE_PATH="$OUT/kafka.keystore.jks" \
  KAFKA_KEYSTORE_PASSWORD_FILE="$OUT/kafka.keystore-password" \
  REPO_ROOT="$REPO_ROOT" \
  bash "$SCRIPT_DIR/verify-kafka-broker-keystore-jks.sh" || exit 1

say "3b. Generating Kafka client cert (mTLS: ssl.client.auth=required)..."
openssl genrsa -out "$TMP/client.key" 2048 2>/dev/null
openssl req -new -key "$TMP/client.key" -out "$TMP/client.csr" \
  -subj "/CN=kafka-client/O=off-campus-housing-tracker" 2>/dev/null
cat > "$TMP/client.ext" <<EOF
[v3_client]
basicConstraints = CA:FALSE
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
EOF
openssl x509 -req -in "$TMP/client.csr" -CA "$CA_PEM" -CAkey "$CA_KEY" \
  -CAcreateserial -out "$TMP/client.crt" -days 365 -sha256 \
  -extensions v3_client -extfile "$TMP/client.ext" 2>/dev/null
cp "$TMP/client.crt" "$OUT/client.crt"
cp "$TMP/client.key" "$OUT/client.key"
ok "Kafka client cert (client.crt, client.key) for Node/KafkaJS mTLS"

ok "Keystore/truststore, ca-cert.pem, and client cert in $OUT"

say "4. Creating kafka-ssl-secret in $NS..."
# Idempotent: avoid "Error from server (AlreadyExists)" when namespace exists
kubectl create namespace "$NS" --dry-run=client -o yaml 2>/dev/null | kubectl apply -f - 2>/dev/null || true
# Use a temp file so apply works with host kubectl (pipe to colima ssh often yields "no objects passed to apply")
_kafka_secret_yaml="${TMP}/kafka-ssl-secret.yaml"
kubectl create secret generic kafka-ssl-secret -n "$NS" \
  --from-file=kafka.keystore.jks="$OUT/kafka.keystore.jks" \
  --from-file=kafka.truststore.jks="$OUT/kafka.truststore.jks" \
  --from-file=kafka.keystore-password="$OUT/kafka.keystore-password" \
  --from-file=kafka.truststore-password="$OUT/kafka.truststore-password" \
  --from-file=kafka.key-password="$OUT/kafka.key-password" \
  --from-file=kafka-broker.pem="$OUT/kafka-broker.pem" \
  --from-file=ca-cert.pem="$OUT/ca-cert.pem" \
  --from-file=ca.crt="$OUT/ca-cert.pem" \
  --from-file=client.crt="$OUT/client.crt" \
  --from-file=client.key="$OUT/client.key" \
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

say "4b. Creating och-kafka-ssl-secret (same client material; Deployments mount och-kafka-ssl-secret)…"
_och_kafka_yaml="${TMP}/och-kafka-ssl-secret.yaml"
kubectl create secret generic och-kafka-ssl-secret -n "$NS" \
  --from-file=ca-cert.pem="$OUT/ca-cert.pem" \
  --from-file=client.crt="$OUT/client.crt" \
  --from-file=client.key="$OUT/client.key" \
  --dry-run=client -o yaml >"$_och_kafka_yaml"
if kubectl apply -f "$_och_kafka_yaml" --request-timeout=20s 2>/dev/null; then
  ok "och-kafka-ssl-secret created/updated"
elif [[ "$ctx" == *"colima"* ]] && command -v colima >/dev/null 2>&1 && [[ -f "$_och_kafka_yaml" ]]; then
  colima ssh -- env KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl apply -f "$_och_kafka_yaml" --request-timeout=20s 2>/dev/null && ok "och-kafka-ssl-secret (via colima ssh)" || warn "och-kafka-ssl-secret apply failed"
else
  warn "och-kafka-ssl-secret apply failed"
fi

say "=== Kafka SSL (dev-root-ca) done ==="
echo "  Keystore/truststore: $OUT. Docker Kafka: mount $OUT, use SSL listener 9093."
echo "  Clients (Node/KafkaJS): KAFKA_CA_CERT, KAFKA_CLIENT_CERT, KAFKA_CLIENT_KEY from kafka-ssl-secret (ca-cert.pem, client.crt, client.key)."
echo "  SAN gate: pnpm verify:kafka-tls-sans (uses kafka-broker.pem in kafka-ssl-secret or $OUT/kafka-broker.pem)."
