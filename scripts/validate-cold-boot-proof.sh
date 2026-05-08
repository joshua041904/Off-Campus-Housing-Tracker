#!/usr/bin/env bash
# Cold-boot proof only: destructive test-dev-cold-start + artifact guards (no preflight-lab).
# Run: COLD_BOOT_PROOF_CONFIRM=yes make cold-boot-proof
# Logging: internal tee (no outer `make … | tee`).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ "${COLD_BOOT_PROOF_CONFIRM:-}" != "yes" ]]; then
  echo "❌ guard: Set COLD_BOOT_PROOF_CONFIRM=yes (destructive cold start)." >&2
  exit 2
fi

mkdir -p "$REPO_ROOT/bench_logs"
COLD_BOOT_LOG="${COLD_BOOT_LOG:-$REPO_ROOT/bench_logs/cold-boot-proof-$(date -u +%Y%m%d-%H%M%S).log}"
export COLD_BOOT_LOG
exec > >(tee -a "$COLD_BOOT_LOG") 2>&1

export COLD_START_CONFIRM=yes

stamp() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
make() { command make -C "$REPO_ROOT" "$@"; }

echo "=== cold-boot-proof $(stamp) ==="
echo "REPO_ROOT=$REPO_ROOT"
echo "COLD_BOOT_LOG=$COLD_BOOT_LOG"

echo "▶ make test-dev-cold-start…"
make test-dev-cold-start

for need in \
  "$REPO_ROOT/bench_logs/dev-cold-start-pre.txt" \
  "$REPO_ROOT/bench_logs/dev-cold-start-post.txt" \
  "$REPO_ROOT/bench_logs/dev-cold-start-metrics.json"; do
  [[ -f "$need" ]] || { echo "❌ guard: missing $need" >&2; exit 3; }
done

echo "✅ cold-boot-proof complete $(stamp)"
echo "   Log: $COLD_BOOT_LOG"
exit 0
