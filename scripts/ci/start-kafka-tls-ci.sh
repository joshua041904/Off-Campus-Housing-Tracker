#!/usr/bin/env bash
# Start Confluent Zookeeper + Kafka with strict TLS (SSL listener only, mTLS), matching docker-compose.yml.
# Run after generate-kafka-ci-tls.sh. Intended for GitHub Actions (plain Docker, no plaintext broker).
#
# Host clients: KAFKA_BROKER=127.0.0.1:29094 KAFKA_SSL_ENABLED=true + client PEM paths under certs/kafka-ssl-ci/
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"

NET="${KAFKA_CI_DOCKER_NETWORK:-och-kafka-ci-net}"
ZK_NAME="${KAFKA_CI_ZK_NAME:-zk-ci}"
KAFKA_NAME="${KAFKA_CI_KAFKA_NAME:-kafka-ci}"
SECRETS_DIR="${REPO_ROOT}/certs/kafka-ssl-ci"

bash "$SCRIPT_DIR/generate-kafka-ci-tls.sh"

[[ -f "$SECRETS_DIR/kafka.keystore.jks" ]] || { echo "missing keystore"; exit 1; }

chmod +x "$REPO_ROOT/scripts/verify-kafka-broker-keystore-jks.sh" 2>/dev/null || true
KAFKA_KEYSTORE_PATH="$SECRETS_DIR/kafka.keystore.jks" \
  KAFKA_KEYSTORE_PASSWORD_FILE="$SECRETS_DIR/kafka.keystore-password" \
  REPO_ROOT="$REPO_ROOT" \
  bash "$REPO_ROOT/scripts/verify-kafka-broker-keystore-jks.sh" || exit 1

command -v docker >/dev/null 2>&1 || { echo "docker required"; exit 1; }

docker rm -f "$KAFKA_NAME" "$ZK_NAME" 2>/dev/null || true
docker network rm "$NET" 2>/dev/null || true
docker network create "$NET"

docker run -d --name "$ZK_NAME" --network "$NET" \
  -e ZOOKEEPER_CLIENT_PORT=2181 \
  -e ZOOKEEPER_TICK_TIME=2000 \
  confluentinc/cp-zookeeper:7.5.0

echo "Waiting for Zookeeper..."
zk_ok=0
for _i in $(seq 1 40); do
  if docker exec "$ZK_NAME" bash -c "exec 3<>/dev/tcp/127.0.0.1/2181" 2>/dev/null; then
    zk_ok=1
    break
  fi
  sleep 2
done
if [[ "$zk_ok" != "1" ]]; then
  echo "Zookeeper did not accept connections on 2181" >&2
  docker logs "$ZK_NAME" 2>&1 | tail -40 >&2 || true
  exit 1
fi

docker run -d --name "$KAFKA_NAME" --network "$NET" \
  -p 29094:9093 \
  -v "$SECRETS_DIR:/etc/kafka/secrets:ro" \
  -e KAFKA_BROKER_ID=1 \
  -e "KAFKA_ZOOKEEPER_CONNECT=${ZK_NAME}:2181" \
  -e KAFKA_LISTENERS=SSL://0.0.0.0:9093 \
  -e KAFKA_ADVERTISED_LISTENERS=SSL://127.0.0.1:29094 \
  -e KAFKA_LISTENER_SECURITY_PROTOCOL_MAP=SSL:SSL \
  -e KAFKA_INTER_BROKER_LISTENER_NAME=SSL \
  -e KAFKA_SSL_CLIENT_AUTH=required \
  -e KAFKA_SSL_KEYSTORE_FILENAME=kafka.keystore.jks \
  -e KAFKA_SSL_KEYSTORE_LOCATION=/etc/kafka/secrets/kafka.keystore.jks \
  -e KAFKA_SSL_KEYSTORE_CREDENTIALS=kafka.keystore-password \
  -e KAFKA_SSL_KEY_CREDENTIALS=kafka.keystore-password \
  -e KAFKA_SSL_TRUSTSTORE_FILENAME=kafka.truststore.jks \
  -e KAFKA_SSL_TRUSTSTORE_LOCATION=/etc/kafka/secrets/kafka.truststore.jks \
  -e KAFKA_SSL_TRUSTSTORE_CREDENTIALS=kafka.truststore-password \
  -e KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR=1 \
  -e KAFKA_AUTO_CREATE_TOPICS_ENABLE=false \
  confluentinc/cp-kafka:7.5.0

echo "Waiting for Kafka SSL listener..."
ok=0
for _i in $(seq 1 60); do
  if docker exec "$KAFKA_NAME" bash -c "exec 3<>/dev/tcp/127.0.0.1/9093" 2>/dev/null; then
    ok=1
    break
  fi
  sleep 2
done

if [[ "$ok" != "1" ]]; then
  echo "Kafka failed to open 9093; logs:" >&2
  docker logs "$KAFKA_NAME" 2>&1 | tail -80 >&2 || true
  exit 1
fi

echo "Writing TLS admin client config inside broker..."
docker exec "$KAFKA_NAME" sh -c '
TS_PASS=$(cat /etc/kafka/secrets/kafka.truststore-password)
KS_PASS=$(cat /etc/kafka/secrets/kafka.keystore-password)
KP_PASS=$(cat /etc/kafka/secrets/kafka.key-password 2>/dev/null || echo "$KS_PASS")
{
  echo "security.protocol=SSL"
  echo "ssl.truststore.location=/etc/kafka/secrets/kafka.truststore.jks"
  echo "ssl.truststore.password=${TS_PASS}"
  echo "ssl.keystore.location=/etc/kafka/secrets/kafka.keystore.jks"
  echo "ssl.keystore.password=${KS_PASS}"
  echo "ssl.key.password=${KP_PASS}"
} > /tmp/och-kafka-event-topics.props'

echo "Waiting for Kafka broker API (TLS; not just TCP — controller + metadata must be usable)..."
api_ok=0
for _i in $(seq 1 60); do
  # Exit 0 alone is insufficient; require real ApiVersion output (listener up before election looks like success to some probes).
  if api_out="$(docker exec "$KAFKA_NAME" kafka-broker-api-versions \
    --bootstrap-server localhost:9093 \
    --command-config /tmp/och-kafka-event-topics.props 2>/dev/null)"; then
    if echo "$api_out" | grep -qE '\(id:[[:space:]]*[0-9]+|Produce\([0-9]+\):'; then
      api_ok=1
      break
    fi
  fi
  sleep 2
done
if [[ "$api_ok" != "1" ]]; then
  echo "Kafka broker API did not become ready (kafka-broker-api-versions with valid version lines); logs:" >&2
  docker logs "$KAFKA_NAME" 2>&1 | tail -80 >&2 || true
  exit 1
fi

export KAFKA_DOCKER_CONTAINER="$KAFKA_NAME"
bash "$REPO_ROOT/scripts/create-kafka-event-topics.sh"

echo "Kafka TLS (mTLS) ready on host 127.0.0.1:29094 (topics created, auto-create disabled)"
