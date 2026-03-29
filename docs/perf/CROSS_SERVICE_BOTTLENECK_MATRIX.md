# Cross-service bottleneck matrix (Issues 9 & 10)

**Purpose:** Separate **local** per-service tails from **cross-service contention** (gateway, DB, shared CPU). Update this doc when you have new isolation or full-grid numbers — **one change per optimization iteration**, then re-measure.

**Branch / context:** `feature/system-build` — application-layer performance (p95/p99, amplification, SQL plans), not transport correctness.

---

## How to fill this

| Phase | Command | What you learn |
|--------|---------|----------------|
| **1 — Isolation baseline** | `SSL_CERT_FILE=$PWD/certs/dev-root.pem ./scripts/perf/run-k6-cross-service-isolation.sh` | p50/p95 per script **alone** + cooldowns + `kubectl top` snapshots → `bench_logs/k6-cross-service-*/latency-report.md` |
| **1 — Full grid** | `SSL_CERT_FILE=$PWD/certs/dev-root.pem ./scripts/run-housing-k6-edge-smoke.sh` | Same scripts **back-to-back**; if p95 jumps only here → **contention / ordering** |
| **3 — SQL evidence** | `./scripts/perf/run-all-explain.sh bench_logs/explain-all-<stamp>.md` | Seq scans, sort cost, index use (listings search often **Seq Scan** today — see latest EXPLAIN) |
| **4 — Live contention** | `kubectl top pods -n off-campus-housing-tracker` (during grid) | Disproportionate **api-gateway** CPU → queueing; **Postgres** + many services → DB hotspot |

**Isolation env notes:** `K6_ISO_SKIP_JWT=1` skips JWT-backed scripts if tokens are not configured. Re-run with JWT when you need booking/search-watchlist in the matrix.

---

## Per-path matrix (http_req_duration from k6 summaries)

Values below are from **cross-service isolation** run **2026-03-24** (`bench_logs/k6-cross-service-20260324-162008/`). **Full grid** column is left for your next `run-housing-k6-edge-smoke.sh` pass — paste deltas from that run’s artifacts or `latency-report.md` if you aggregate one.

| Flow | Ingress cost (edge) | Service CPU (watch top) | DB cost | Downstream / notes | p95 isolation | p95 full grid |
|------|---------------------|-------------------------|---------|----------------------|---------------|---------------|
| Gateway health | TLS + route | api-gateway | — | — | **15.4 ms** | — |
| Auth health | TLS + route | auth-service | low | — | **52.6 ms** | — |
| Listings health | TLS + route | listings-service | **SELECT 1** | — | **127.6 ms** | — |
| Booking health | TLS + route | booking-service | low | — | **52.5 ms** | — |
| Trust public GET | TLS + route | trust-service | query flags | — | **62.0 ms** | — |
| Analytics public | TLS + route | analytics-service | metrics / events | — | **94.6 ms** | — |
| Messaging (CAR-style in iso) | TLS + route | messaging-service | varies | Kafka adjacent | **19.9 ms** | — |
| Media health | TLS + route | media-service | optional | 502/503 tolerated in script | **22.2 ms** | — |
| Event-layer adversarial | TLS + route | event pipeline | — | synthetic load | **22.3 ms** | — |
| Analytics listing-feel | TLS + route | analytics + **Ollama** | — | slow if model cold | **57.4 ms** | — |

**Empirical max (p100) outliers in same run:** listings-health **2225 ms**, booking-health **1201 ms**, analytics-public **1087 ms** — treat as **tail probes**; investigate with timing logs + DB, not average-only.

---

## Classification

| Pattern | Symptom | Likely class |
|---------|---------|--------------|
| p95 high **only** in full grid | Isolation OK | **Cross-service contention** (gateway queue, DB pool, CPU) |
| p95 high **in isolation** | Same service solo | **Local bottleneck** (SQL, handler, pool, JSON) |
| Malformed load slower than health | Bad input does more work than good | **Validation bypass**, wrong image, or **search still hitting DB** |
| Gateway CPU ≫ others under grid | — | **Ingress queueing / buffering** |
| Postgres CPU high with many pods | — | **DB hotspot** or missing index |

---

## Top tail offenders (this isolation run)

**By p(95) http_req_duration:**

1. **Listings health** — **~128 ms** — prioritize **listings search SQL + indexes** (EXPLAIN shows **Seq Scan** on `listings.listings` for representative search — see `bench_logs/explain-all-attempt-20260324-163045.md` or fresh `run-all-explain.sh` output).  
   **One next step:** composite / partial index aligned with `WHERE status = active AND deleted_at IS NULL ORDER BY created_at DESC` + review ILIKE cost (see [LISTINGS_SEARCH.md](./LISTINGS_SEARCH.md)).

2. **Analytics public** — **~95 ms** — **events** table **Seq Scan** in EXPLAIN probe; daily_metrics path uses index.  
   **One next step:** retention / index on hot analytics query paths or pre-aggregation — **measure** before wide refactors.

**Honorable mention (max, not p95):** booking-health large **max** sample — confirm with `LISTINGS_HTTP_TIMING`-style instrumentation on booking if tails persist.

---

## Per-service k6 coverage (this repo)

| Service | Concurrency (ramping-VUs) | Malformed / abuse | Slow-path / stress |
|---------|---------------------------|---------------------|---------------------|
| Listings | `k6-listings-concurrency.js` | `k6-listings-malformed.js` | `k6-listings-search-slowpath.js` |
| Booking | `k6-booking-concurrency.js` | (extend: JWT create/confirm) | — |
| Analytics | `k6-analytics-concurrency.js` | — | `k6-analytics-ramp.js` / listing-feel |
| Messaging | `k6-messaging-concurrency.js` | — | `k6-messaging-ramp.js`, suite scripts |
| Trust | `k6-trust-concurrency.js` | (add bad UUID cases if needed) | — |
| Media | `k6-media-concurrency.js` | — | `k6-media-upload.js` |

**pnpm:** `pnpm run k6:listings:concurrency`, `k6:trust:concurrency`, `k6:media:concurrency`, `k6:listings:search-slowpath`, etc. (see root `package.json`).

---

## Optimization workflow (discipline)

1. Pick **at most two** hot paths from the matrix.  
2. Change **one** lever (index, query, pool size, gateway limit — **not** all at once).  
3. Re-run **the same** k6 command and compare p95/p99.  
4. Record before/after in this file or `bench_logs/`.  
5. Repeat.

---

## Related docs

- [TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md](./TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md)  
- [PERF_EXECUTION_ORDER_PHASES_A_B_C.md](./PERF_EXECUTION_ORDER_PHASES_A_B_C.md)  
- [ISSUES_9_10_OPTIMIZATION_WORKFLOW.md](./ISSUES_9_10_OPTIMIZATION_WORKFLOW.md) (short checklist)
