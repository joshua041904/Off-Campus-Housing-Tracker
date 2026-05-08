#!/usr/bin/env bash
# Summarize what `make preflight-lab` runs after cluster bring-up: suite *types* and rough counts.
# Read-only; no cluster access. Run: bash scripts/report-preflight-lab-suite-inventory.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== Shared lab body: make preflight-strict / preflight-lab (_preflight-strict-run) — ordered gates ==="
printf '%s\n' \
  "1 bash  cluster-stability-guard.sh" \
  "1 make  transport-quic-v6-v7-prove" \
  "1 pnpm  preflight-and-suites → scripts/run-preflight-scale-and-all-suites.sh (phases 1–6 + step 7 matrix + post-7)" \
  "1 vitest analytics-service (pnpm --filter analytics-service test)" \
  "1 k6    scripts/load/k6-analytics-smoke.js" \
  "2 bash  verify-http3.sh, verify-google-maps.sh"

echo ""
echo "=== make preflight-lab only (_preflight-lab-inner after the above) — coverage matrix plumbing ==="
printf '%s\n' \
  "1 bash  gateway-image-source-staleness-guard.sh (warn if api-gateway:dev older than route-coverage sources)" \
  "2 make  fetch-gateway-route-hits (before + after Vitest matrix)" \
  "1 bash  run-matrix-vitest-coverage.sh (SKIP_MATRIX_VITEST=1 skips)" \
  "1 node  verify-api-docs + och-coverage-model + och-service-coverage-matrix (SERVICE_COVERAGE_MATRIX_ENFORCE=1)" \
  "1 node  generate-preflight-lab-report.mjs → bench_logs/preflight-lab-report.md"
echo ""
echo "  Optional: make k6-coverage-warmup — debug-only manifest sweep (x-suite=coverage-warmup → matrix unknown bucket; not in preflight-lab)."
echo "  Endpoint union = manifest routes hit with any x-suite; per-suite columns attribute hits (k6 via mergeEdgeTls, bash curl gates, Playwright extraHTTPHeaders)."

echo ""
echo "=== Step 7 matrix (_run_all_suites in run-preflight-scale-and-all-suites.sh) — by type ==="
# Discrete invocations (not file counts).
cat <<'INV'
  bash/guards     verify-required-housing-pods.sh, _preflight_ci_transport_alignment_gates (transport scripts)
  vitest          services/event-layer-verification (pnpm test)
  vitest (stack)  pnpm test:vitest-stack = integration:all + test:system + repo test (default PREFLIGHT_RUN_REPO_VITEST_STACK=1)
  vitest          services/messaging-service (pnpm test), services/media-service (pnpm test)
  bash            test-microservices-http2-http3-housing.sh, test-messaging-service-comprehensive.sh
  playwright      run-playwright-e2e-preflight.sh (1× when PREFLIGHT_VALIDATE_BEFORE_LOAD=1 default, else after k6)
  k6 (edge grid)  run-housing-k6-edge-smoke.sh — 9 core smokes + listing-feel (unless SKIP) + 2 JWT scripts + optional preflight-lab randomized (PREFLIGHT_LAB=1 → ~12–13 k6 invocations)
INV

echo ""
echo "=== Optional blocks (env-gated in same preflight script) ==="
cat <<'OPT'
  k6 phases       scripts/load/run-k6-phases.sh (read/soak/…/realistic) when PREFLIGHT_RUN_K6_PHASES=1
  jaeger step7  trace-validators when PREFLIGHT_STEP7_OBSERVABILITY_GATES=1
  phase D / listings k6  when PREFLIGHT_PHASE_D_TAIL_LAB / listings lab flags on
OPT

echo ""
echo "=== Approximate share of *step-7* wall time by category (lab; typical defaults) ==="
echo "  Vitest + integration stack  ~35–50%  (event-layer + vitest-stack + 2 service packages)"
echo "  Bash HTTP suites             ~8–15%"
echo "  k6 edge grid + hooks         ~25–40%"
echo "  Playwright                   ~15–25%"
echo "  (Percentages are heuristic — actual split depends on PREFLIGHT_LAB, Phase D, SKIP flags, and machine.)"

echo ""
echo "For full phase-1–6 breakdown see header comments in: scripts/run-preflight-scale-and-all-suites.sh"
