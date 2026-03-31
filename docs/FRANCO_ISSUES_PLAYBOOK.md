# Franco — Search / filters / UI validation playbook

**Owner:** Franco  

**Note:** [`Github_issues copy.txt`](../Github_issues%20copy.txt) in the repo root is **Joshua’s** backlog (listings, trust, media, webapp). This document is the **Franco search / filters / UI** playbook. For Joshua, see [`JOSHUA_ISSUES_PLAYBOOK.md`](JOSHUA_ISSUES_PLAYBOOK.md). For Arkar (platform/auth/analytics), see [`ARKAR_ISSUES_PLAYBOOK.md`](ARKAR_ISSUES_PLAYBOOK.md).

Markdown companion for Franco’s track (when not using the root `.txt`): align with [`FRANCO_SEARCH_UI_VALIDATION.md`](FRANCO_SEARCH_UI_VALIDATION.md).

**Related:** [Engineering Validation Spec v2](../Github_issues.txt) · [Detailed validation guide](./FRANCO_SEARCH_UI_VALIDATION.md) (overlap; this playbook is organized **one section per issue**).

---

## Overview

This playbook is self-contained: every issue has **why**, **commands**, **success criteria**, **debug**, and **done when**.

### Request flow

```text
curl / browser / Playwright
  → edge (Caddy TLS, hostname off-campus-housing.test)
  → api-gateway
  → listings-service :4012  |  booking-service :4013  |  auth (gateway gRPC)
```

### Why we validate this way

- The real edge uses **HTTPS + SNI**. Use `https://off-campus-housing.test` with `certs/dev-root.pem` — same as Playwright and users.
- `--resolve HOST:443:LB_IP` pins the IP without breaking certificate hostname checks.
- Do **not** use `http://127.0.0.1:4020` for validation; isolate with `kubectl port-forward` to **service** ports (e.g. listings `4012`) when comparing gateway vs upstream.

---

## Table of contents

1. [Step 0 — Environment](#step-0--environment)
2. [Step 0a — Sanity checks](#step-0a--sanity-checks)
3. [Query contract (listings search)](#query-contract-listings-search)
4. [Issue 1 — Listings filters full flow](#issue-1--listings-filters-full-flow-keyword--price--sort--pet_friendly)
5. [Issue 2 — Listings filters not resolving (UI)](#issue-2--listings-filters-not-resolving-ui--loading--aria-busy)
6. [Issue 3 — Search history save API flow](#issue-3--search-history-save-api-flow-dashboard)
7. [Issue 4 — Retry logic for flaky Playwright tests](#issue-4--retry-logic-for-flaky-playwright-tests)
8. [Issue 5 — Disabled search submit button](#issue-5--disabled-search-submit-button-dashboard)
9. [Issue 6 — Sorting options](#issue-6--sorting-options-backend--ui-alignment)
10. [Issue 7 — Distance-based search filter](#issue-7--distance-based-search-filter)
11. [Issue 8 — Search query performance](#issue-8--search-query-performance)
12. [Issue 9 — Search result consistency](#issue-9--search-result-consistency-no-dupes-stable-order)
13. [Issue 10 — Playwright test for search filters](#issue-10--playwright-test-for-search-filters-new-or-extend)
14. [Global debug cheat sheet](#global-debug-cheat-sheet)
15. [Cursor / implementer rules](#cursor--implementer-rules)
16. [Repo file index](#repo-file-index)

---

## Step 0 — Environment

Run once per shell, from **repo root**.

### Commands

```bash
cd "$(git rev-parse --show-toplevel)"

export EDGE_HOST="${EDGE_HOST:-off-campus-housing.test}"
export EDGE_PORT="${EDGE_PORT:-443}"
export CA_CERT="${CA_CERT:-$PWD/certs/dev-root.pem}"
# Set OCH_EDGE_IP from your cluster (MetalLB / ingress EXTERNAL-IP), e.g.:
#   kubectl get svc -A | grep LoadBalancer
export OCH_EDGE_IP="${OCH_EDGE_IP:-192.168.64.240}"

export EDGE_BASE_HTTPS="https://${EDGE_HOST}"
```

Every edge `curl` below should include:

```bash
--cacert "$CA_CERT" --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}"
```

### Success

- `test -s "$CA_CERT"` passes (or run `./scripts/dev-generate-certs.sh`)
- `OCH_EDGE_IP` matches your LoadBalancer / ingress IP

### Debug

| Problem | Action |
|--------|--------|
| CA missing | `./scripts/dev-generate-certs.sh` · `ls -l certs/dev-root.pem` |
| Wrong IP | `kubectl get svc -n ingress-nginx` · `kubectl get svc -n off-campus-housing-tracker \| grep LoadBalancer` |

---

## Step 0a — Sanity checks

**Why:** Confirms edge + TLS + routing before debugging listings logic.

### Caddy / edge liveness (HTTP/1.1)

```bash
curl --http1.1 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/_caddy/healthz"
```

**Success:** HTTP **2xx** (often 200).

### Listings health via gateway (HTTP/2)

```bash
curl --http2 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/healthz"
```

**Success:** Response line contains `HTTP/2` and status **200**; JSON may warn if DB disconnected.

### HTTP/3 (optional — `curl -V` must show HTTP3)

```bash
curl --http3 -v --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/_caddy/healthz"
```

**Success:** Verbose output shows QUIC / HTTP/3 and **2xx**.

### Same API path over HTTP/3

```bash
curl --http3 -sS -o /dev/null -w "http_version=%{http_version} http_code=%{http_code}\n" \
  --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?sort=created_desc"
```

**Success:** `http_version=3` and `http_code=200`. If `--http3` is unsupported, skip and note in PR.

### Debug (TLS / Playwright)

| Symptom | Likely cause |
|--------|----------------|
| `curl: (60)` certificate | Wrong `CA_CERT` or URL hostname not in cert — use `EDGE_HOST`, not raw IP in URL |
| Connection refused | Wrong `OCH_EDGE_IP` or edge not on 443 |
| 404 on `/api/listings/healthz` | Gateway routing — `services/api-gateway/src/server.ts` |

**Node / Playwright** cannot use `--resolve`. Add `/etc/hosts`:

```bash
sudo sh -c 'grep -qF "${OCH_EDGE_IP} ${EDGE_HOST}" /etc/hosts || echo "${OCH_EDGE_IP} ${EDGE_HOST}" >> /etc/hosts'
```

Or: `OCH_AUTO_EDGE_HOSTS=1` — see `scripts/lib/edge-test-url.sh` and `Github_issues.txt` §3.

---

## Query contract (listings search)

**Why:** UI and `curl` must use the same query param names the server reads.

| Item | Detail |
|------|--------|
| **Endpoint** | `GET ${EDGE_BASE_HTTPS}/api/listings/search?...` (**public**, no JWT) |
| **Prices** | `min_price`, `max_price` are **integer cents** (same as JSON `price_cents`) |
| **Params** | `q`, `min_price`, `max_price`, `smoke_free`, `pet_friendly`, `furnished`, `amenities`, `new_within_days`, `sort` |
| **sort** | `created_desc` \| `listed_desc` \| `price_asc` \| `price_desc` |

**Implementation**

- `services/listings-service/src/http-server.ts`
- `services/listings-service/src/search-listings-query.ts`

**Webapp mirror:** `webapp/lib/api.ts` → `searchListings()`

---

## Issue 1 — Listings filters full flow (keyword + price + sort + pet_friendly)

### Why

Renters combine keyword, price band, sort, and pet-friendly. Any mismatch between UI query string and SQL `WHERE`/`ORDER BY` breaks trust in search.

### Scope

- `webapp/app/listings/page.tsx`, `webapp/lib/api.ts`
- `services/listings-service/src/http-server.ts`, `search-listings-query.ts`
- `services/api-gateway/src/server.ts` (`OPEN_ROUTES` for public `GET` search)

### Step 1 — HTTP/2 full filter

```bash
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?q=apartment&min_price=100000&max_price=300000&sort=price_desc&pet_friendly=1"
```

### Success (Step 1)

- Status: **HTTP/2 200**
- JSON with top-level `"items"` array
- Every item: `100000 <= price_cents <= 300000`
- `price_cents` non-increasing (price_desc)
- Every item: `"pet_friendly": true`

### Step 2 — HTTP/1.1 cross-check

```bash
curl --http1.1 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?min_price=100000&sort=price_asc"
```

### Success (Step 2)

- **HTTP/1.1 200**
- `price_cents` non-decreasing (nulls last per SQL)

### Step 3 — HTTP/3 (same URL as Step 1)

```bash
curl --http3 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?q=apartment&min_price=100000&max_price=300000&sort=price_desc&pet_friendly=1"
```

### Success (Step 3)

Same JSON checks as Step 1; protocol HTTP/3.

### Step 4 — Direct isolation (gateway vs upstream)

```bash
kubectl port-forward svc/listings-service 4012:4012 -n off-campus-housing-tracker
```

Other terminal:

```bash
curl -sS -i "http://127.0.0.1:4012/search?min_price=100000&sort=price_asc"
```

### Success (Step 4)

**200** JSON `{ "items": ... }` on upstream path **`/search`** (no `/api/listings` prefix).

### Debug matrix

| Symptom | Likely cause |
|--------|----------------|
| 401 on edge | `OPEN_ROUTES` missing for `GET /api/listings/search` |
| 500 | SQL/pool — `kubectl logs -n off-campus-housing-tracker deploy/listings-service` |
| 200 wrong prices | UI sent dollars; backend expects **cents** |
| 200 wrong sort | `search-listings-query.ts` `ORDER BY` |
| Empty `items` | Only `active`, non-deleted rows; seed data may not match filters |

### Done when

- [ ] HTTP/1.1 + HTTP/2 + (if supported) HTTP/3: **200** + consistent `items`
- [ ] Filters and sort verified on JSON
- [ ] UI sends same params as `webapp/lib/api.ts`

---

## Issue 2 — Listings filters not resolving (UI / loading / aria-busy)

### Why

Stuck loading blocks the page; Playwright expects `aria-busy="false"` on listings results. React `aria-busy={false}` often **omits** the attribute, so tests fail while idle.

### Scope

- `webapp/app/listings/page.tsx`

### Step 1 — Prove backend is fast

```bash
curl --http2 -sS -o /dev/null -w "code=%{http_code} time_total=%{time_total}s\n" \
  --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search"
```

### Success

`code=200` and `time_total` reasonable (e.g. a few seconds on dev).

### Step 2 — Frontend fixes

- Clear loading in `finally` → `setLoading(false)`
- Prefer `aria-busy={loading ? "true" : "false"}` (strings)
- Split loading: e.g. `resultsLoading` vs `formLoading`

### Step 3 — Playwright

```bash
cd webapp
export E2E_API_BASE="${EDGE_BASE_HTTPS}"
export NODE_EXTRA_CA_CERTS="../certs/dev-root.pem"
pnpm exec playwright test e2e/listings-filters-maps.spec.ts --repeat-each=3
```

Or from repo root (waits for readyz):

```bash
./scripts/run-playwright-e2e-preflight.sh
```

### Success

3× green on `listings-filters-maps` (or project `03-listings`).

### Debug

- Traces/screenshots under `test-results/`
- Network: `/api/listings/search` status + body
- DOM: is `aria-busy` missing vs `"false"`?

### Done when

- [ ] `aria-busy` contract satisfied
- [ ] Results render after search + initial load
- [ ] Spec stable (3 runs or agreed CI retries)

---

## Issue 3 — Search history save API flow (dashboard)

### Why

Dashboard persists searches in the booking DB; JSON must match Prisma fields and JWT must reach the gateway (→ `x-user-id`).

### Scope

- `webapp/lib/api.ts`, `webapp/app/dashboard/page.tsx`
- `services/booking-service/src/server.ts`
- `services/api-gateway/src/server.ts` (`/api/booking` proxy — **JWT required**)

### Endpoints

- `POST ${EDGE_BASE_HTTPS}/api/booking/search-history`
- `GET ${EDGE_BASE_HTTPS}/api/booking/search-history/list?limit=50`

### Step 1 — Login (JWT)

```bash
RESP="$(curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -X POST "${EDGE_BASE_HTTPS}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"YOUR_USER@example.com","password":"YOUR_PASSWORD"}')"

export TOKEN="$(printf '%s' "$RESP" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
test -n "$TOKEN" || { echo "LOGIN FAILED: $RESP"; exit 1; }
```

### Success

Non-empty `TOKEN`.

### Debug

Print `RESP`; MFA users need a non-MFA test account for automation.

### Step 2 — POST search history

```bash
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -X POST "${EDGE_BASE_HTTPS}/api/booking/search-history" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"apartment","minPriceCents":100000,"maxPriceCents":300000}'
```

### Success

**HTTP/2 201** + JSON created row.

### Step 3 — GET list

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -H "Authorization: Bearer $TOKEN" \
  "${EDGE_BASE_HTTPS}/api/booking/search-history/list?limit=50"
```

### Success

JSON `{ "items": [ ... ] }` includes an entry matching query/prices.

### Step 4 — HTTP/1.1 and HTTP/3

Repeat Steps 2–3 with `--http1.1` and `--http3` instead of `--http2`.

### Debug matrix

| Symptom | Cause |
|--------|--------|
| 401 | Missing/expired token; bad `Authorization` header |
| 500 | Prisma/DB — `kubectl logs -n off-campus-housing-tracker deploy/booking-service` |
| 201 but not in list | Wrong user; `limit` too small; list handler bug |

### Done when

- [ ] API round-trip proves persistence
- [ ] UI shows row after save + refresh (`e2e/flows.spec.ts`)

---

## Issue 4 — Retry logic for flaky Playwright tests

### Why

Bounded retries and polls separate infra flake from broken assertions.

### Scope

- `webapp/playwright.config.ts`, `webapp/e2e/*.spec.ts`

### Steps

- Increase CI retries if policy allows, e.g. `retries: process.env.CI ? 2 : 0`
- Replace fixed sleeps with `await expect.poll(...)`

### Run

```bash
cd webapp
pnpm exec playwright test --project=02-auth-booking --project=03-listings --repeat-each=3
```

### Success

All repeats pass.

### Debug

Traces; `PWDEBUG=1` for one test; read stderr timeout lines.

### Done when

3× green locally or CI with agreed retry policy.

---

## Issue 5 — Disabled search submit button (dashboard)

### Why

`disabled={loading}` on save; if `refreshAll()` never finishes or shares the flag, button stays disabled — `flows.spec` times out.

### Scope

- `webapp/app/dashboard/page.tsx` (`data-testid="search-submit"`)

### Fix direction

Split **initial** vs **submit** loading (e.g. `initialLoading` / `submitLoading`).

### Validate

```bash
cd webapp
pnpm exec playwright test --project=02-auth-booking e2e/flows.spec.ts
```

### Success

Test passes; manually, after dashboard loads the button is enabled.

### Debug

React DevTools → loading; Network → `search-history/list` stuck?

### Done when

`flows.spec` green + quick manual check.

---

## Issue 6 — Sorting options (backend + UI alignment)

### Why

Predictable order for UX and tests; invalid `sort` should fall back safely.

### Allowed values

`created_desc` | `listed_desc` | `price_asc` | `price_desc` — see `search-listings-query.ts`.

### HTTP/2

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?sort=price_asc"
```

### Success

Ascending `price_cents`.

### Determinism (`jq`)

```bash
for i in 1 2 3; do
  curl --http2 -sS --cacert "$CA_CERT" \
    --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
    "${EDGE_BASE_HTTPS}/api/listings/search?sort=created_desc" \
    | jq -c '[.items[].id]'
done
```

### Success

Three **identical** lines.

### HTTP/3

Same URL with `--http3`.

### Done when

- [ ] UI sends `sort=` for all four values where applicable
- [ ] Backend defaults invalid sort safely

---

## Issue 7 — Distance-based search filter

### Why

Geo search must not return listings outside the radius.

### Current repo status

`lat`, `lng`, `max_distance_km` are **not** implemented in `search-listings-query.ts` yet. Listings have `latitude` / `longitude` for create/display.

### When implemented — validation

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?lat=40.7128&lng=-74.0060&max_distance_km=5"
```

### Success

Only in-radius rows; document formula (haversine vs PostGIS).

### Debug

Wrong results → lat/lng swap, units, radians vs degrees.

### Done when

Curl + tests in PR; until then mark **N/A** on checklist.

---

## Issue 8 — Search query performance

### Why

Slow search hurts UX and load tests; `EXPLAIN` surfaces missing indexes.

### Scope

- `listings-service`, `scripts/perf/explain-listings-search.sh`, k6

### Baseline k6 (repo root)

```bash
SSL_CERT_FILE="$PWD/certs/dev-root.pem" \
  ./scripts/k6-exec-strict-edge.sh ./scripts/load/k6-listings-health.js
```

### Success

Record **p95** from k6 summary (put in PR).

### EXPLAIN

```bash
PGHOST=127.0.0.1 PGPORT=5442 PGDATABASE=listings ./scripts/perf/explain-listings-search.sh
```

### Success

Understand seq scan vs index; no psql `ERROR`.

### Rebuild after change

```bash
pnpm run rebuild:service:listings
# or
SERVICES=listings-service ./scripts/rebuild-och-images-and-rollout.sh
```

### Done when

Before/after **p95** posted; error rate not worse.

---

## Issue 9 — Search result consistency (no dupes, stable order)

### Why

Duplicate ids or reordering on identical queries → unstable SQL or missing `ORDER BY` tie-break.

### Three id lists

```bash
for i in 1 2 3; do
  curl --http2 -sS --cacert "$CA_CERT" \
    --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
    "${EDGE_BASE_HTTPS}/api/listings/search?sort=created_desc" \
    | jq -c '[.items[].id]'
done
```

### Success

Three identical lines.

### Duplicates inside one response

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?sort=created_desc" \
  | jq '[.items[].id] | group_by(.) | map(select(length>1)) | length'
```

### Success

Prints **0**.

### Debug

Duplicates → `DISTINCT ON` / fix join source. Order drift → add `id` tie-break to `ORDER BY`.

### Done when

`jq` checks pass + Playwright green.

---

## Issue 10 — Playwright test for search filters (new or extend)

### Why

Locks UI↔API contract so regressions fail in CI.

### Target

- `webapp/e2e/search-filters.spec.ts` (**new**), or extend `listings-filters-maps.spec.ts`

### Steps

1. Test: set min price, keyword, sort; wait for `/api/listings/search` **200**
2. If new file: add to `webapp/playwright.config.ts` project **`03-listings`** `testMatch`
3. Run:

```bash
cd webapp
pnpm exec playwright test e2e/search-filters.spec.ts
```

### Success

Spec green with edge E2E base (hosts + CA — see Issue 2).

### Done when

Merged + stable in CI.

---

## Global debug cheat sheet

```bash
kubectl logs -n off-campus-housing-tracker deploy/api-gateway --tail=100
kubectl logs -n off-campus-housing-tracker deploy/listings-service --tail=100
kubectl logs -n off-campus-housing-tracker deploy/booking-service --tail=100
```

Verbose TLS:

```bash
curl -v --http2 --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search"
```

Discovery: route order in `http-server.ts`; `OPEN_ROUTES` in `api-gateway/server.ts`.

---

## Cursor / implementer rules

1. Use `EDGE_BASE_HTTPS` + `--cacert` + `--resolve` for edge curls.
2. HTTP/2 over TLS: `curl --http2` (**not** `--http2-prior-knowledge`).
3. Listings search **public**; booking history **JWT** required.
4. `min_price` / `max_price` are **cents**.
5. Do not use `http://127.0.0.1:4020` for validation.

---

## Repo file index

| Area | Path |
|------|------|
| Listings HTTP / search | `services/listings-service/src/http-server.ts` |
| Listings SQL | `services/listings-service/src/search-listings-query.ts` |
| Gateway | `services/api-gateway/src/server.ts` |
| Booking HTTP | `services/booking-service/src/server.ts` |
| Webapp API | `webapp/lib/api.ts` |
| Listings UI | `webapp/app/listings/page.tsx` |
| Dashboard UI | `webapp/app/dashboard/page.tsx` |
| Playwright | `webapp/playwright.config.ts`, `webapp/e2e/*.spec.ts` |
| k6 / perf | `scripts/k6-exec-strict-edge.sh`, `scripts/load/k6-listings*.js`, `scripts/perf/explain-listings-search.sh` |
