#!/usr/bin/env bash
# Idempotency proof: dev + dev-verify twice (no cluster wipe).
# Run: IDEMPOTENCY_PROOF_CONFIRM=yes make idempotency-proof
# Logging: internal tee (no outer `make … | tee`).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ "${IDEMPOTENCY_PROOF_CONFIRM:-}" != "yes" ]]; then
  echo "❌ guard: Set IDEMPOTENCY_PROOF_CONFIRM=yes (runs make dev twice)." >&2
  exit 2
fi

mkdir -p "$REPO_ROOT/bench_logs"
IDEMPOTENCY_PROOF_LOG="${IDEMPOTENCY_PROOF_LOG:-$REPO_ROOT/bench_logs/idempotency-proof-$(date -u +%Y%m%d-%H%M%S).log}"
export IDEMPOTENCY_PROOF_LOG
exec > >(tee -a "$IDEMPOTENCY_PROOF_LOG") 2>&1

stamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
make() { command make -C "$REPO_ROOT" "$@"; }

echo "=== idempotency-proof $(stamp) ==="
echo "REPO_ROOT=$REPO_ROOT"
echo "IDEMPOTENCY_PROOF_LOG=$IDEMPOTENCY_PROOF_LOG"

echo "▶ cycle 1: make dev && make dev-verify…"
make dev
make dev-verify

echo "▶ cycle 2: make dev && make dev-verify…"
make dev
make dev-verify

[[ -f "$REPO_ROOT/bench_logs/dev-state.json" ]] || {
  echo "❌ guard: missing bench_logs/dev-state.json after cycles" >&2
  exit 3
}

echo "✅ idempotency-proof complete $(stamp)"
echo "   Log: $IDEMPOTENCY_PROOF_LOG"
exit 0
