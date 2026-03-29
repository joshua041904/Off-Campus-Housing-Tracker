# Performance lab command matrix (operator playbook)

Single reference for **what to run** and **what to open** after ceiling + modeling work.

## Phase 1 — Regenerate artifacts

From repo root (needs cluster + k6 for a fresh ceiling; otherwise uses latest `bench_logs/ceiling/*`):

```bash
make capacity-one
```

This runs, in order:

1. `performance-lab-one` — latest ceiling `results.csv` → `combined-10` → `build-performance-lab.js`
2. `capacity-recommend` — `derive-pool-sizes.js` → `capacity-recommendations.json`, `ingress-tuning.md`, `capacity-dashboard-schema.json`
3. `protocol-happiness` — `compute-happiness.js` → happiness matrix + superiority + `protocol-ranking.md`
4. `transport-routing-hints` — `build-transport-default-hints.js` → `transport-default-hints.json` (negative τ → prefer HTTP/2 as default)
5. `perf-lab-dashboards` — `envelope-dashboard.json`, `transport-dominance-heatmap.json`

Each of those targets (and `make performance-lab-interpret` / `performance-lab-interpret-latest` when used alone) also runs **`bundle-performance-lab-10`**, which merges the loose artifacts into exactly **10 files** under **`bench_logs/performance-lab/PERF_LAB_CANONICAL_10/`** (full JSON/Markdown content preserved — merge only, no truncation). Run `make bundle-performance-lab-10` anytime to refresh that folder from the current `performance-lab/` tree.

Outputs live under **`bench_logs/performance-lab/`** (plus the **`PERF_LAB_CANONICAL_10/`** handoff bundle).

## Phase 2 — Files to inspect

| File | Purpose |
|------|---------|
| `protocol-happiness-matrix.json` | Per-service scores, `winner_utilization_pool_10`, τ, `h3_transport_unlocked` |
| `protocol-superiority-scores.json` | Per-protocol score components + `tail_penalty` |
| `protocol-ranking.md` | Human-readable ranking |
| `capacity-recommendations.json` | Pool / stream-cap hints |
| `collapse-summary.json` | Collapse VU / reason / max RPS pre-collapse |
| `envelope-dashboard.json` | Flat rows for charts |
| `transport-dominance-heatmap.json` | Pool × μ-scale grid (regions: http2-dominant / http3-dominant / backend-bound) |
| `PERF_LAB_CANONICAL_10/*` | Ten-file bundle (`01-manifest.json` … `10-transport-dominance-heatmap.json`) — same data as the rows above, repacked for sharing |
| `transport-default-hints.json` | Per-service τ and `prefer_http2_default` where HTTP/3 is not a transport win |
| `infra/k8s/base/config/strict-envelope.json` | Declared `configured_db_pool_max` + ingress stream ceilings — must cover `capacity-recommendations.json` |
| `infra/k8s/base/config/transport-routing-defaults.json` | Slim list `prefer_http2_default_for_services` — refresh with `make transport-routing-hints-sync-k8s` when policy changes |

## Deploy gate — strict envelope

`scripts/deploy-dev.sh` runs **`strict-envelope-check.js`** before `kubectl apply` when `capacity-recommendations.json` exists (unless `SKIP_STRICT_ENVELOPE=1`). It fails if `recommended_pool > configured_db_pool_max` for any service or if recommended HTTP/2 or HTTP/3 stream caps exceed `ingress.*_max_concurrent_streams`.

- `make strict-envelope-check` — same check locally.
- After changing pools or ingress limits, update **`strict-envelope.json`** to match what you deploy.

## Transport lab (edge H2 / H3 strict / gRPC)

Requires a reachable cluster (MetalLB + Caddy + `curl` with `--http3-only` recommended).

| Command | Purpose |
|---------|---------|
| `make full-edge-transport-validation` | All services → `bench_logs/transport-lab/per-service/*.json` + `transport-validation-report.json` |
| `make transport-lab` | Edge suite (unless `SKIP_FULL_EDGE=1`) + endpoint coverage + optional k6 collapse smoke + `final-transport-artifact.json` |
| `make endpoint-coverage` | Heuristic `endpoint-coverage-report.json` (static; safe on CI) |
| `make collapse-smoke` | k6 gateway health with strict thresholds (`scripts/load/k6-gateway-collapse-smoke.js`) |

QUIC analyzers live under `scripts/lib/`; with `TRANSPORT_LAB_QUIC=1`, `run-transport-lab.sh` writes `transport-lab/quic/analysis/dominance-map.json` and compose sets `quic_pipeline: "integrated"`. Otherwise `quic_pipeline` is `"not_integrated"`.

Declare readiness with a composed artifact:

`node scripts/protocol/declare-readiness.js --perf-dir bench_logs/performance-lab --transport-artifact bench_logs/transport-lab/final-transport-artifact.json`

## Advisory — adaptive pools (Option 2)

With observed RPS JSON (service → λ) and `service-models.json` μ:

```bash
make adaptive-pool-suggest OBSERVED_RPS_JSON=scripts/protocol/fixtures/example-observed-rps.json
```

Uses target utilization **0.75** (override via script `--util`). Output is suggestions only — compare with `capacity-recommendations.json` before changing prod.

## Phase 3 — Quick jq checks

```bash
# Utilization + transport unlock
jq '.rows[] | {service, winner_utilization_pool_10, transport_gain_tau, h3_transport_unlocked, recommended_pool}' \
  bench_logs/performance-lab/protocol-happiness-matrix.json

# One service
jq '.rows[] | select(.service=="analytics")' bench_logs/performance-lab/protocol-happiness-matrix.json
jq '.rows[] | select(.service=="auth")' bench_logs/performance-lab/protocol-happiness-matrix.json
```

**τ / unlock rule**

- If `transport_gain_tau <= 0` (or H3 not materially faster than H2 in the model), expect `h3_transport_unlocked: false`.
- If `transport_gain_tau > 0` and `recommended_pool >= pool_threshold_ceil`, expect `h3_transport_unlocked: true`.

## Phase 4 — Automated readiness gate

Strict multi-gate check (often **fails** on raw lab data until pools and tails are tuned):

```bash
make declare-readiness
# or
node scripts/protocol/declare-readiness.js --perf-dir bench_logs/performance-lab
```

Options:

- `--strict-envelope` — also fail when predicted safe RPS @ pool 10 ≥ collapse RPS (experimental; off by default because definitions differ).
- `--panic-scan` — scan matrix/k6 `.log` files under `bench_logs` for `panic`.
- `--max-pool N` — fail if recommended pool &gt; N (default 200).

**CI smoke** (passing fixture only):

```bash
./scripts/protocol/validate-production-readiness.sh --fixture
```

## Phase 5 — Operator shell script

```bash
./scripts/protocol/validate-production-readiness.sh
PERF_DIR=bench_logs/performance-lab ./scripts/protocol/validate-production-readiness.sh
```

## Phase 6 — Optional load re-checks

After changing pool env in cluster (future PR):

```bash
DURATION=60s VUS=20 SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/load/run-trust-protocol-stress.sh
make protocol-happiness
```

Protocol matrix single cells (see script header for exact args):

```bash
SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/load/run-k6-protocol-matrix.sh http2 trust
```

## Phase 7 — What “green” means

`PRODUCTION_READY=true` only when **all** gates in `declare-readiness.js` pass. On typical dev/colima runs you will see `PRODUCTION_READY=false` until utilization &lt; 0.85 at pool 10, fail rates &lt; 2%, and tail penalties stay within the median-based band.

Treat that as **expected** during development; use the fixture path to verify the gate wiring in CI.

## See also

- `GITHUB_PR_DESCRIPTION_PR2.txt` — protocol scoring + dominance (PR #2)
- `GITHUB_PR_DESCRIPTION_PR3.txt` — governance + readiness + dashboards (PR #3)
