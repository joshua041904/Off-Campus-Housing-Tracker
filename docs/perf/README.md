# Performance engineering notes

**New teammate / first PR:** paste the GitHub PR body from repo root **`GITHUB_PR_DESCRIPTION.txt`** (includes 3-reviewer breakdown + runbook). Short pointer: [PR_FIRST_CONTRIBUTION.md](../PR_FIRST_CONTRIBUTION.md).

## Centralized report (EXPLAIN + k6)

**One command** — writes `bench_logs/perf-report-<timestamp>/PERF_REPORT.md`:

```bash
./scripts/perf/run-perf-full-report.sh
```

**Options:**

| Env | Effect |
|-----|--------|
| `PERF_QUICK=1` | Shorter k6 duration/VUs for health scripts |
| `PERF_INCLUDE_RAMPS=1` | Also run `k6-listings-ramp.js`, `k6-analytics-ramp.js`, `k6-messaging-ramp.js` (long) |
| `PERF_SKIP_EVENT_LAYER=1` | Skip `k6-event-layer-adversarial.js` |
| `PGHOST` / `PGPASSWORD` | Postgres host for EXPLAIN (default `127.0.0.1`, DBs on **5441–5448**) |

**Pieces:**

| Script | Purpose |
|--------|---------|
| `scripts/perf/run-all-explain.sh` | `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` for **auth, listings, bookings, messaging, notification, trust, analytics, media** |
| `scripts/perf/run-all-k6-load-report.sh` | k6 health grid + optional ramps → Markdown |
| `scripts/perf/run-k6-cross-service-isolation.sh` | **Cross-service analysis:** each edge k6 script **alone** + `kubectl top` snapshots + summaries → `bench_logs/k6-cross-service-*` ([TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md](./TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md)) |
| `scripts/perf/sql/explain-*.sql` | One file per database |
| `scripts/perf/explain-listings-search.sh` | Listings-only (legacy helper) |
| `scripts/perf/snapshot-pg-locks.sh` | During dual k6: snapshot `pg_locks` (ungranted) + `pg_stat_activity` waiters (`PGPORT` per DB) |
| `scripts/perf/run-preflight-phase-d-tail-lab.sh` | Phase D orchestration: schema (best-effort), EXPLAIN, k6 listings + analytics + dual contention; preflight defaults `PREFLIGHT_PHASE_D_TAIL_LAB=full` (set `0` to skip) |

**Preflight packaging:** `run-preflight-scale-and-all-suites.sh` writes one directory per process: **`bench_logs/run-<PREFLIGHT_RUN_STAMP>/`** (`PREFLIGHT_RUN_DIR`), containing `preflight-full.log`, telemetry, `k6-suite-resources.log`, `phase-d/`, `suite-logs/`, pgbench outputs when enabled, etc. Override with `PREFLIGHT_RUN_DIR` or `PREFLIGHT_RUN_STAMP`.

**Postgres:** EXPLAIN targets **host** databases (Docker Compose / local), not in-cluster Postgres unless you port-forward or set `PGHOST` to a reachable server.

**k6:** Requires `k6`, `certs/dev-root.pem`, and edge up (`https://off-campus-housing.test`). On macOS, dev CA should be in the keychain for host k6 (see `scripts/lib/trust-dev-root-ca-macos.sh`).

## Docs

| Doc | Purpose |
|-----|---------|
| [TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md](./TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md) | **Team focus:** tail latency (advanced) + cross-service / suite contention — evidence, hypotheses, hooks (`K6_SUITE_*`), next steps |
| [PERF_EXECUTION_ORDER_PHASES_A_B_C.md](./PERF_EXECUTION_ORDER_PHASES_A_B_C.md) | **Order of work:** Phase A (listings PR review + baseline k6) → Phase B (`k6-*-concurrency.js`, `k6-dual-service-contention.js`) → Phase C (edge smoke + isolation) |
| [ISSUES_9_10_OPTIMIZATION_WORKFLOW.md](./ISSUES_9_10_OPTIMIZATION_WORKFLOW.md) | **Issues 9 & 10:** isolation vs full grid, EXPLAIN, gateway top — disciplined tail + cross-service workflow |
| [TAIL_OPTIMIZATION_PHASE_D_REPORT.md](./TAIL_OPTIMIZATION_PHASE_D_REPORT.md) | **Phase D:** listings index + dual-contention procedure + analytics caveat + gateway experiment; before/after table |
| [CROSS_SERVICE_BOTTLENECK_MATRIX.md](./CROSS_SERVICE_BOTTLENECK_MATRIX.md) | **Bottleneck matrix:** per-flow p95, classification, top offenders, index/SQL next steps |
| [LISTINGS_VALIDATION_PR_REVIEW_fix-listings-validation.md](./LISTINGS_VALIDATION_PR_REVIEW_fix-listings-validation.md) | Short checklist for `fix/listings-validation-response-handling` |
| [LISTINGS_VALIDATION_DEEP_REVIEW.md](./LISTINGS_VALIDATION_DEEP_REVIEW.md) | **Deep review:** hot-path cost model, before/after flows, DB protection, concurrency, sample k6 tables, merge gate |
| [CLUSTER_CONTENTION_WATCH.md](./CLUSTER_CONTENTION_WATCH.md) | **Prove contention:** second-terminal `watch-cluster-contention.sh` → file; `K6_SUITE_RESOURCE_LOG` auto-append; Envoy restart + drop_caches knobs |
| [LISTINGS_SEARCH.md](./LISTINGS_SEARCH.md) | Exact SQL for listings browse/search + `search_norm` vs `ILIKE` |
| [LISTINGS_HTTP_TIMING.md](./LISTINGS_HTTP_TIMING.md) | **Request timing + pg pool logs** in listings-service (`LISTINGS_HTTP_TIMING=1`) to debug k6 tails vs DB |

## k6 scripts (`scripts/load/`)

| File | Role |
|------|------|
| `k6-listings-ramp.js` | Arrival-rate ramp — listings search |
| `k6-listings-search-slowpath.js` | Worst-case ILIKE + wide price band — SQL tail probe |
| `k6-trust-concurrency.js` | Ramping-VUs — trust reputation |
| `k6-media-concurrency.js` | Ramping-VUs — media healthz |
| `k6-analytics-ramp.js` | Ramp — analytics daily-metrics |
| `k6-messaging-ramp.js` | Ramp — messaging healthz |
| `run-k6-all-services.sh` | Full grid + `aggregate-k6-summaries.py` |

**Telemetry during ramps** (optional):

```bash
kubectl top pods -n off-campus-housing-tracker -w
```

```bash
# If Postgres runs in-cluster (adjust deployment name):
kubectl exec -n off-campus-housing-tracker deploy/postgres -- \
  psql -U postgres -c "SELECT state, wait_event_type, count(*) FROM pg_stat_activity GROUP BY 1,2 ORDER BY 1,2;"
```
