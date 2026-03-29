# Performance work — disciplined execution order (Issues 9 & 10)

Use this so **tail latency (Issue 9)**, **cross-service analysis (Issue 10)**, and **teammate PRs** (e.g. listings validation) do not create branch spaghetti.

**Branches (example):**

| Branch | Role |
|--------|------|
| `main` | Integration / perf baseline (former `feature/system-build` merged) |
| `fix/listings-validation-response-handling` | Teammate PR — **review here first** |

**Rule:** Do perf baselines and Issue 9/10 **after** validating the PR on its own branch. Do **not** merge the teammate branch into a perf experiment branch until you have a clean review + optional standalone k6 delta. Prefer **separate** `perf/analysis-*` branches for long-running experiments if needed.

---

## Phase A — PR review + risk profiling (before heavy perf)

**Applies to:** `origin/fix/listings-validation-response-handling` (or any listings validation PR).

1. **Checkout the PR branch** (read-only review or local checkout):
   ```bash
   git fetch origin
   git checkout fix/listings-validation-response-handling   # or: git diff main..origin/fix/listings-validation-response-handling
   ```
2. **Diff vs your baseline** (`main`):
   ```bash
   git diff main..HEAD -- services/listings-service
   ```
3. **Focus:** `src/validation.ts`, HTTP + gRPC handler call sites, order of validation vs auth vs DB.
4. **Confirm:** no DB inside validation; sync-only validation; shared module for HTTP + gRPC (single validation path, not triple duplicate).
5. **Build:**
   ```bash
   pnpm --filter listings-service build
   ```
6. **Standalone load (edge, same as always):**
   ```bash
   SSL_CERT_FILE="$PWD/certs/dev-root.pem" k6 run scripts/load/k6-listings-health.js
   ```
   Save **p95/p99** (and optionally run twice). Compare to **pre-PR** baseline on the same cluster conditions.
7. **If p95 regresses** — profile validation cost (regex/allocations), not sysctl.

**Written audit for the listings validation PR:** [LISTINGS_VALIDATION_PR_REVIEW_fix-listings-validation.md](./LISTINGS_VALIDATION_PR_REVIEW_fix-listings-validation.md)

---

## Phase B — Strengthen per-service load coverage

### Layer 1 — Hot-path guardrails (optional local micro-bench)

After `validation.ts` is merged, add `services/listings-service/scripts/bench-validation-hot-path.ts` (or Vitest) that calls `validateListingId`, `validateSearchFilters`, and `validateCreateListingInput` in a tight loop (~200 rounds) and asserts median latency &lt; ~5ms (tune for CI). This is **not** a substitute for edge k6; it catches accidental sync-path regressions in validation only.

### Layer 2 — Per-service concurrency k6 (isolation)

**Ramping-VUs only** (no constant-arrival-rate here — avoids iteration drops through the gateway).

| Script | Endpoint focus |
|--------|----------------|
| `scripts/load/k6-listings-concurrency.js` | Health + light search (exercises filters) |
| `scripts/load/k6-messaging-concurrency.js` | Messaging health |
| `scripts/load/k6-analytics-concurrency.js` | Public analytics path |
| `scripts/load/k6-booking-concurrency.js` | Booking health |
| `scripts/load/k6-listings-malformed.js` | Abuse/malformed inputs — expect fast **4xx** once PR image is deployed (see [LISTINGS_VALIDATION_DEEP_REVIEW.md](./LISTINGS_VALIDATION_DEEP_REVIEW.md)) |

Run **one script at a time** from repo root:

```bash
SSL_CERT_FILE="$PWD/certs/dev-root.pem" k6 run scripts/load/k6-listings-concurrency.js
```

Tune `DURATION`, stages via env (see each file header).

### Layer 3 — Dual-service contention (gateway interference)

```bash
SSL_CERT_FILE="$PWD/certs/dev-root.pem" DUAL_PAIR=messaging+listings k6 run scripts/perf/k6-dual-service-contention.js
```

Valid `DUAL_PAIR` values include: `messaging+listings`, `analytics+listings`, `booking+messaging` (see script).

---

## Phase C — Issue 9 / 10 proper (full grid + isolation)

Only after Phase A (PR understood) and Phase B (per-service scripts stable in isolation):

```bash
SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/run-housing-k6-edge-smoke.sh
SSL_CERT_FILE="$PWD/certs/dev-root.pem" ./scripts/perf/run-k6-cross-service-isolation.sh
```

Compare **isolation** vs **full grid** using `docs/perf/TAIL_LATENCY_AND_CROSS_SERVICE_ANALYSIS.md`.

---

## Quick command summary

| Step | Command |
|------|---------|
| PR build | `pnpm --filter listings-service build` |
| Listings health baseline | `SSL_CERT_FILE="$PWD/certs/dev-root.pem" k6 run scripts/load/k6-listings-health.js` |
| Listings concurrency | `SSL_CERT_FILE="$PWD/certs/dev-root.pem" k6 run scripts/load/k6-listings-concurrency.js` |
| Listings malformed / abuse | `SSL_CERT_FILE="$PWD/certs/dev-root.pem" k6 run scripts/load/k6-listings-malformed.js` |
| Dual contention | `SSL_CERT_FILE="$PWD/certs/dev-root.pem" k6 run scripts/perf/k6-dual-service-contention.js` |
| Full edge grid | `./scripts/run-housing-k6-edge-smoke.sh` |
| Isolation matrix | `./scripts/perf/run-k6-cross-service-isolation.sh` |
