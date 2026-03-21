#!/usr/bin/env bash
# Event layer: Vitest (services/event-layer-verification) + proto/topic contracts + optional Kafka partition verify + optional k6 adversarial.
#
# Usage: ./scripts/run-event-layer-verification.sh
#   SKIP_VITEST=1          skip pnpm test in event-layer-verification
#   SKIP_PROTO_VERIFY=1    skip verify-proto-events-topics.sh
#   SKIP_PARTITION_VERIFY=1 skip verify-kafka-event-topic-partitions.sh (or set SKIP_KAFKA_VERIFY=1 inside)
#   RUN_K6_ADVERSARIAL=1   run scripts/load/k6-event-layer-adversarial.js (needs k6 + BASE_URL/CA like other k6 scripts)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"
export PATH="$SCRIPT_DIR/shims:/opt/homebrew/bin:/usr/local/bin:${PATH:-}"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok() { echo "✅ $*"; }
warn() { echo "⚠️  $*"; }

say "=== Event layer verification ==="

if [[ "${SKIP_VITEST:-0}" != "1" ]]; then
  say "Vitest (event-layer-verification)"
  pnpm --filter event-layer-verification run test
  ok "Vitest complete"
else
  warn "SKIP_VITEST=1"
fi

if [[ "${SKIP_PROTO_VERIFY:-0}" != "1" ]]; then
  say "Proto ↔ topic contract"
  "$SCRIPT_DIR/verify-proto-events-topics.sh"
else
  warn "SKIP_PROTO_VERIFY=1"
fi

if [[ "${SKIP_PARTITION_VERIFY:-0}" != "1" ]]; then
  say "Kafka topic partition count (EXPECTED=6)"
  "$SCRIPT_DIR/verify-kafka-event-topic-partitions.sh" || warn "Partition verify failed or skipped (Kafka down?)"
else
  warn "SKIP_PARTITION_VERIFY=1"
fi

if [[ "${RUN_K6_ADVERSARIAL:-0}" == "1" ]]; then
  say "k6 adversarial (event-layer companion load)"
  if command -v k6 >/dev/null 2>&1; then
    mkdir -p "$REPO_ROOT/bench_logs"
    K6_CA_ABSOLUTE="${K6_CA_ABSOLUTE:-$REPO_ROOT/certs/dev-root.pem}"
    export SSL_CERT_FILE="${K6_CA_ABSOLUTE}"
    k6_extra=()
    [[ ! -f "$K6_CA_ABSOLUTE" ]] && k6_extra+=(--insecure-skip-tls-verify) && warn "Missing CA; k6 --insecure-skip-tls-verify"
    k6 run "${k6_extra[@]}" --summary-export "$REPO_ROOT/bench_logs/k6-event-layer-adversarial-summary.json" \
      "$SCRIPT_DIR/load/k6-event-layer-adversarial.js" || warn "k6 adversarial exited non-zero"
  else
    warn "k6 not installed; skip RUN_K6_ADVERSARIAL"
  fi
fi

say "=== Event layer verification done ==="
