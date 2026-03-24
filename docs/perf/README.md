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

**Postgres:** EXPLAIN targets **host** databases (Docker Compose / local), not in-cluster Postgres unless you port-forward or set `PGHOST` to a reachable server.

**k6:** Requires `k6`, `certs/dev-root.pem`, and edge up (`https://off-campus-housing.test`). On macOS, dev CA should be in the keychain for host k6 (see `scripts/lib/trust-dev-root-ca-macos.sh`).

## Docs

| Doc | Purpose |
|-----|---------|
| [TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md](./TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md) | **Team focus:** tail latency (advanced) + cross-service / suite contention — evidence, hypotheses, hooks (`K6_SUITE_*`), next steps |
| [CLUSTER_CONTENTION_WATCH.md](./CLUSTER_CONTENTION_WATCH.md) | **Prove contention:** second-terminal `watch-cluster-contention.sh` → file; `K6_SUITE_RESOURCE_LOG` auto-append; Envoy restart + drop_caches knobs |
| [LISTINGS_SEARCH.md](./LISTINGS_SEARCH.md) | Exact SQL for listings browse/search + `search_norm` vs `ILIKE` |
| [LISTINGS_HTTP_TIMING.md](./LISTINGS_HTTP_TIMING.md) | **Request timing + pg pool logs** in listings-service (`LISTINGS_HTTP_TIMING=1`) to debug k6 tails vs DB |

## k6 scripts (`scripts/load/`)

| File | Role |
|------|------|
| `k6-listings-ramp.js` | Arrival-rate ramp — listings search |
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
