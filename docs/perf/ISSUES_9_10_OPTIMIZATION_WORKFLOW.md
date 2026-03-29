# Issues 9 & 10 — optimization workflow (tail latency + cross-service mapping)

**Issue 9 — Tail latency optimization**  
**Issue 10 — Cross-service bottleneck mapping**

You are past “green checks” and transport proof. Focus: **p95/p99**, **amplification**, **SQL plans**, **gateway queueing**, **shared resource contention**.

---

## Phase 1 — Baselines (no noise)

1. **Isolation** (clean per-service tail):

   ```bash
   SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/perf/run-k6-cross-service-isolation.sh
   ```

   Output: `bench_logs/k6-cross-service-*/latency-report.md` (+ JSON summaries). Fix `aggregate-k6-summaries.py` if needed — it merges `*-summary.json`.

2. **Full grid** (contention):

   ```bash
   SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/run-housing-k6-edge-smoke.sh
   ```

3. **Compare:** If p95 rises **only** in the grid → **cross-service contention**. If high **in isolation** → **local** bottleneck.

---

## Phase 2 — Per-service suites

Use **ramping-VUs** concurrency scripts (not only health):

- Listings / booking / analytics / messaging — already present under `scripts/load/`.
- **Trust / media:** `k6-trust-concurrency.js`, `k6-media-concurrency.js`.
- **Listings slow SQL path:** `k6-listings-search-slowpath.js`.

Malformed / abuse: listings `k6-listings-malformed.js`; extend others as routes allow.

---

## Phase 3 — DB & query audit

```bash
./scripts/perf/run-all-explain.sh bench_logs/explain-all-$(date +%Y%m%d-%H%M%S).md
```

Inspect listings search plans: **Seq Scan**, **Sort**, filter cost — see [CROSS_SERVICE_BOTTLENECK_MATRIX.md](./CROSS_SERVICE_BOTTLENECK_MATRIX.md).

---

## Phase 4 — Gateway amplification

During full grid:

```bash
kubectl top pods -n off-campus-housing-tracker
```

Interpret: gateway hot → queueing; many services + Postgres hot → DB contention; single service hot → service-local.

---

## Phase 5 — Bottleneck matrix

Maintain **[CROSS_SERVICE_BOTTLENECK_MATRIX.md](./CROSS_SERVICE_BOTTLENECK_MATRIX.md)** with isolation vs full-grid p95 and classifications.

---

## Rule

**Never change three things at once.** One experiment → identical load → document delta → repeat.
