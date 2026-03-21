#!/usr/bin/env bash
# Thin orchestrator: optional standalone capture → listings H2/H3 test (same env as other suites).
# For full matrix, use run-preflight-scale-and-all-suites.sh or run-all-test-suites.sh.
#
# Usage: ./scripts/run-coherent-edge-analysis.sh
# Env: Same as test-packet-capture-standalone.sh (HOST, PORT, TARGET_IP, SKIP_*)
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

say "1/3 Optional: standalone packet capture (set SKIP_STANDALONE_CAPTURE=1 to skip)"
if [[ "${SKIP_STANDALONE_CAPTURE:-0}" != "1" ]] && [[ -x "$SCRIPT_DIR/test-packet-capture-standalone.sh" ]]; then
  "$SCRIPT_DIR/test-packet-capture-standalone.sh" || true
fi

say "2/3 Listings HTTP/2 + HTTP/3 health/search"
[[ -x "$SCRIPT_DIR/test-listings-http2-http3.sh" ]] && "$SCRIPT_DIR/test-listings-http2-http3.sh" || true

say "3/3 Done. See docs/RUN_PIPELINE_ORDER.md and scripts/lib/COHERENT_ANALYSIS.md for ordering and lib chain."
