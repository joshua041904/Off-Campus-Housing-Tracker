# Phase D — Tail optimization (data-driven)

**Issues:** 9 (tail latency), 10 (cross-service contention).  
**Rules:** one change at a time; re-run the **same** k6 profile after each change; record p50 / p95 / p99 / max and attach EXPLAIN when SQL changes.

## Baseline (cross-service isolation, example run)

Source: `bench_logs/k6-cross-service-20260324-162008/latency-graph.html` (edge health paths).

| Service | p95 (ms) | max (ms) | Notes |
|---------|----------|----------|--------|
| gateway-health | 15 | 288 | Healthy |
| messaging | 19 | 152 | Healthy |
| media-health | 22 | 71 | Healthy |
| event-layer-adversarial | 22 | 435 | — |
| auth-health | 52 | 245 | — |
| booking-health | 52 | 1201 | Occasional spikes |
| trust-public | 61 | 618 | — |
| analytics-listing-feel | 57 | 389 | — |
| **analytics-public** | **94** | **1086** | **Steady tail** |
| **listings-health** | **127** | **2224** | **Highest steady p95** |

**Narrative:** prioritize **listings** then **analytics-public** at the application layer; gateway/messaging/media are not the primary steady tail.

## Before / after (fill after each experiment)

| Area | Before p95 | After p95 | Delta | Evidence |
|------|------------|-----------|-------|----------|
| Listings (concurrency script) | _run k6_ | _after index / query change_ | | k6 summary + `EXPLAIN (ANALYZE, BUFFERS)` |
| Analytics public | _~94 ms (isolation)_ | _after change_ | | k6 + route-level timing |
| Full grid / dual contention | _baseline_ | _after each track_ | | `run-housing-k6-edge-smoke.sh` or `k6-dual-service-contention.js` |

## Track 1 — Listings (index + query shape)

1. **Current plan:** `./scripts/perf/run-all-explain.sh` and listings-specific SQL under `scripts/perf/sql/`. Look for seq scan, sort, filter ratio, rows scanned vs returned.
2. **Code fact:** `services/listings-service/src/search-listings-query.ts` uses **`LIMIT 50` only — no `OFFSET`**. Keyset pagination is not required for that path unless another endpoint adds offset later.
3. **Change applied in repo (single concrete step):** partial index for the default public browse sort:

   - File: `infra/db/06-listings-active-created-at-index.sql`
   - Index: `idx_listings_active_created_desc` on `(created_at DESC)` where `status = 'active' AND deleted_at IS NULL`

   Apply via `./scripts/ensure-listings-schema.sh` (or `psql -f` against the listings DB).

4. **Re-run load:** `SSL_CERT_FILE="$PWD/certs/dev-root.pem" k6 run scripts/load/k6-listings-concurrency.js`  
   Higher VUs: `VUS=20 k6 run scripts/load/k6-listings-concurrency.js`

## Track 2 — DB lock contention (analytics + listings)

1. **Dual load:**  
   `SSL_CERT_FILE="$PWD/certs/dev-root.pem" DUAL_PAIR=analytics+listings k6 run scripts/perf/k6-dual-service-contention.js`
2. **While running**, snapshot locks (second terminal):

   ```bash
   PGPORT=5442 ./scripts/perf/snapshot-pg-locks.sh listings
   PGPORT=5447 ./scripts/perf/snapshot-pg-locks.sh analytics
   ```

   Interpret: many **ungranted** locks or long `wait_event` rows → contention; pool logs showing `waiting > 0` → pool pressure.

## Track 3 — Analytics public path

**Important:** `scripts/load/k6-analytics-public.js` hits **`GET /api/analytics/daily-metrics`**. The analytics service uses a **single-row lookup** on `analytics.daily_metrics` by `date` (PK in `infra/db/01-analytics-schema.sql`). A materialized view over `bookings GROUP BY city` does **not** match this endpoint — treat MV/pre-agg as a **hypothesis only** after identifying the actual slow query for the route that regresses.

Reasonable levers for **daily-metrics** tail: TLS/edge hop, connection pool, cold cache, or **other** analytics routes if the suite expands.

## Track 4 — Gateway backpressure + in-flight coalescing (experiment)

Gateway p95 is already low in isolation; this track is **hardening**, not the first fix.

- **Backpressure:** cap concurrent upstream proxy work; fail fast with 503 instead of unbounded queueing.
- **Coalescing:** dedupe identical in-flight upstream requests (cache promise by key); clear on settle.

Re-run: `SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/run-housing-k6-edge-smoke.sh` (or your standard full grid) and compare listings/analytics tails **after** listings + analytics tracks are measured.

## Preflight integration

After the k6 edge service grid (step 7a), `scripts/run-preflight-scale-and-all-suites.sh` runs `scripts/perf/run-preflight-phase-d-tail-lab.sh` by default (**`PREFLIGHT_PHASE_D_TAIL_LAB=full`**: Phase D + cross-service isolation). Set **`PREFLIGHT_PHASE_D_TAIL_LAB=0`** to skip.  
`SSL_CERT_FILE` defaults to **`$REPO_ROOT/certs/dev-root.pem`** when that file exists and the variable is unset.  
`make demo` sets `PREFLIGHT_PHASE_D_TAIL_LAB=0` for a shorter path.  
Phase D output defaults to **`$PREFLIGHT_RUN_DIR/phase-d`** (same run folder as `preflight-full.log` — see `bench_logs/run-<stamp>/`).

Gateway hardening (rebuild **api-gateway** image after pull): `GATEWAY_PROXY_MAX_INFLIGHT` (0 = off) and `GATEWAY_COALESCE_ANALYTICS_DAILY` (`1` = coalesce identical `GET /api/analytics/daily-metrics` queries). Defaults are off in `infra/k8s/base/api-gateway/deploy.yaml`.

## Deliverable checklist

- [ ] Listings: baseline k6 → apply `06` index → same k6 → table row filled.
- [ ] Dual contention: run k6 + `snapshot-pg-locks.sh` → short note in this doc.
- [ ] Analytics: confirm which SQL runs for the measured route; one optimization with before/after.
- [ ] Gateway: design note or implemented change **separate** PR/commit from DB/index work.
