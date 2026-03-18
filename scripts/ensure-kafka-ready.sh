#!/usr/bin/env bash
# Ensure Kafka is ready and accessible before proceeding
# Proactive check - starts Kafka if needed and waits for it to be ready

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()  { echo "✅ $*"; }
warn(){ echo "⚠️  $*"; }
log() { echo "[$(date +%H:%M:%S)] $*"; }

KAFKA_PORT=29093
MAX_WAIT=60

say "=== Ensuring Kafka is Ready ==="

# Check if Kafka is already accessible
if nc -z 127.0.0.1 "$KAFKA_PORT" 2>/dev/null; then
  ok "Kafka port $KAFKA_PORT is already accessible"
  exit 0
fi

log "Kafka port $KAFKA_PORT not accessible, checking Docker containers..."

  # Check if containers exist
  if ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qE "kafka|zookeeper"; then
    warn "Kafka/Zookeeper containers not found, starting..."
    cd "$SCRIPT_DIR/.." && docker compose up -d zookeeper kafka 2>&1 | tail -5
  else
    # Check Kafka logs for SSL errors
    kafka_status=$(docker compose ps kafka --format json 2>/dev/null | python3 -c "import sys, json; d=json.load(sys.stdin); print(d[0]['State'] if d else 'unknown')" 2>/dev/null || echo "unknown")
    if echo "$kafka_status" | grep -qE "restarting|exited"; then
      log "Kafka is $kafka_status, checking logs for errors..."
      ssl_error=$(docker compose logs kafka --tail=20 2>&1 | grep -i "KAFKA_SSL_KEYSTORE_FILENAME" | head -1 || echo "")
      if [[ -n "$ssl_error" ]]; then
        log "  Found SSL configuration error, ensuring docker-compose.yml has KAFKA_SSL_KEYSTORE_FILENAME"
        log "  Restarting Kafka with updated config..."
      fi
      cd "$SCRIPT_DIR/.." && docker compose stop kafka 2>&1 | tail -2
      sleep 2
      cd "$SCRIPT_DIR/.." && docker compose up -d kafka 2>&1 | tail -3
    elif ! nc -z 127.0.0.1 "$KAFKA_PORT" 2>/dev/null; then
      # Container running but port not accessible - restart
      log "Kafka container running but port not accessible, restarting..."
      cd "$SCRIPT_DIR/.." && docker compose restart kafka 2>&1 | tail -3
    fi
  fi

log "Waiting for Kafka to be ready on port $KAFKA_PORT (max ${MAX_WAIT}s)..."
for i in $(seq 1 $MAX_WAIT); do
  if nc -z 127.0.0.1 "$KAFKA_PORT" 2>/dev/null; then
    ok "Kafka is now accessible on port $KAFKA_PORT (took ${i}s)"
    
    # Also patch kafka-external endpoint to ensure it points to correct host IP
    if [[ -f "$SCRIPT_DIR/patch-kafka-external-host.sh" ]]; then
      log "Patching kafka-external endpoint to point to host IP..."
      chmod +x "$SCRIPT_DIR/patch-kafka-external-host.sh" 2>/dev/null || true
      "$SCRIPT_DIR/patch-kafka-external-host.sh" 2>&1 | tail -2 || warn "Endpoint patch failed (may not exist yet)"
    fi
    
    exit 0
  fi
  if [[ $((i % 5)) -eq 0 ]]; then
    log "  Still waiting... (${i}s elapsed)"
  fi
  sleep 1
done

warn "Kafka port $KAFKA_PORT still not accessible after ${MAX_WAIT}s"
warn "  Check: docker compose ps kafka zookeeper"
warn "  Logs: docker compose logs kafka"
exit 1
