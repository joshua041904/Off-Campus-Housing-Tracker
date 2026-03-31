# Franco — Search / Filters / UI validation playbook

This guide aligns with [Github_issues.txt](../Github_issues.txt) (Engineering Validation Spec v2) and replaces ambiguous `http://<ip>` edge examples with **TLS + SNI + dev CA**, which is what Caddy, HTTP/2, and HTTP/3 actually use in this repo.

**Plain-text backlog (Joshua — listings, trust, media, webapp):** [`Github_issues copy.txt`](../Github_issues%20copy.txt) in the repo root. **Markdown hub + per-issue files:** [`docs/JOSHUA_ISSUES_PLAYBOOK.md`](JOSHUA_ISSUES_PLAYBOOK.md), [`docs/joshua/`](joshua/). **Arkar track (standalone MD):** [`docs/ARKAR_ISSUES_PLAYBOOK.md`](ARKAR_ISSUES_PLAYBOOK.md).

**Franco search UI — Markdown playbook (numbered issues, TOC):** [`docs/FRANCO_ISSUES_PLAYBOOK.md`](FRANCO_ISSUES_PLAYBOOK.md).

**Owner:** Franco  
**Services touched:** `listings-service`, `api-gateway`, `booking-service`, `auth-service`, `webapp`

---

## How requests flow

```text
curl / browser / Playwright
  → edge (Caddy TLS, hostname off-campus-housing.test)
  → api-gateway
  → listings-service :4012  OR  booking-service :4013  OR  auth (gRPC-backed login on gateway)
```

Public **listings search** does **not** need JWT. **Booking search-history** does.

**Query param contract (listings search):** `q`, `min_price`, `max_price`, `smoke_free`, `pet_friendly`, `furnished`, `amenities`, `new_within_days`, `sort` — all parsed in:

- `services/listings-service/src/http-server.ts`
- `services/listings-service/src/search-listings-query.ts`

**Important:** `min_price` / `max_price` are **integer cents** (same as `price_cents` in JSON), not dollars.

**Webapp client mirror:** `webapp/lib/api.ts` → `searchListings()`.

---

## Step 0 — One-time environment (run from repo root)

### 0.1 Variables

```bash
cd "$(git rev-parse --show-toplevel)"

export EDGE_HOST="${EDGE_HOST:-off-campus-housing.test}"
export EDGE_PORT="${EDGE_PORT:-443}"
export CA_CERT="${CA_CERT:-$PWD/certs/dev-root.pem}"
export OCH_EDGE_IP="${OCH_EDGE_IP:-192.168.64.240}"   # set from: kubectl get svc -A | grep LoadBalancer

export EDGE_BASE_HTTPS="https://${EDGE_HOST}"
```

Use **`EDGE_BASE_HTTPS`** for all edge curls (not `http://<raw-ip>`). Raw IP breaks certificate hostname validation unless you jump through extra hoops.

### 0.2 TLS + SNI + fixed LB IP (copy-paste pattern)

Every edge `curl` below uses:

- `--cacert "$CA_CERT"` — trust the dev CA (`scripts/dev-generate-certs.sh` creates it).
- `--resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}"` — DNS name points at the MetalLB / ingress IP without editing `/etc/hosts` for **curl only**.

**Playwright / Node** still need `off-campus-housing.test` to resolve (e.g. `/etc/hosts` or `OCH_AUTO_EDGE_HOSTS=1` — see `scripts/lib/edge-test-url.sh` and `Github_issues.txt` §3).

### 0.3 Sanity check (stop if this fails)

```bash
curl --http1.1 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/_caddy/healthz"
```

**Look for:** `HTTP/1.1` and a **2xx** status.

```bash
curl --http2 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/healthz"
```

**Look for:** status line contains `HTTP/2` and **200**.

### 0.4 HTTP/3 (optional; needs curl with HTTP/3)

```bash
curl --http3 -v --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/_caddy/healthz"
```

**Look for:** verbose output shows QUIC / HTTP/3 and **2xx**.

Then hit the **same API path** over HTTP/3:

```bash
curl --http3 -sS -o /dev/null -w "http_version=%{http_version} http_code=%{http_code}\n" \
  --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?sort=created_desc"
```

**Look for:** `http_version=3` and `http_code=200`. If `curl: option --http3` is unknown, skip HTTP/3 and note that in the PR.

---

## Issue 1 — Listings filters full flow (keyword + price + sort + pet)

### Scope

`webapp/app/listings/page.tsx`, `webapp/lib/api.ts`, `services/listings-service/src/http-server.ts`, `services/listings-service/src/search-listings-query.ts`

### Step 1 — HTTP/2 full filter request

```bash
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?q=apartment&min_price=100000&max_price=300000&sort=price_desc&pet_friendly=1"
```

**Look for:**

| Check | Pass criteria |
|--------|----------------|
| Status | `HTTP/2 200` |
| Body shape | JSON with top-level `"items"` array |
| Prices | Every item: `min_price <= price_cents <= max_price` (100000–300000) |
| Sort | Non-increasing `price_cents` down the array |
| Pet filter | Every item has `"pet_friendly": true` |

### Step 2 — HTTP/1.1 cross-check (same semantics)

```bash
curl --http1.1 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?min_price=100000&sort=price_asc"
```

**Look for:** `HTTP/1.1 200` and same filter logic as HTTP/2 (ascending price).

### Step 3 — HTTP/3 (same URL as Step 1)

```bash
curl --http3 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?q=apartment&min_price=100000&max_price=300000&sort=price_desc&pet_friendly=1"
```

**Look for:** HTTP/3 + 200 + same JSON checks as Step 1.

### Direct isolation (optional)

```bash
kubectl port-forward svc/listings-service 4012:4012 -n off-campus-housing-tracker
curl -sS "http://127.0.0.1:4012/search?min_price=100000&sort=price_asc"
```

**Note:** Upstream path is `/search` (gateway strips `/api/listings`).

### Failure matrix

| Symptom | Likely cause |
|---------|----------------|
| 401 | Gateway treating public search as protected — check `OPEN_ROUTES` in `services/api-gateway/src/server.ts` |
| 500 | SQL / pool error in listings — logs in `listings-service` pod |
| 200 wrong sort | `ORDER BY` in `search-listings-query.ts` |
| Prices outside range | Cents vs dollars bug in UI or wrong query param names |
| Empty `items` when data exists | `status != active` or `deleted_at` filter |

### Done when

- [ ] HTTP/1.1 + HTTP/2 + (if available) HTTP/3 return **200** with consistent `items`
- [ ] Filters and sort match the table above
- [ ] UI on `/listings` sends the same params as `webapp/lib/api.ts`

---

## Issue 2 — Listings filters not resolving (UI / `aria-busy`)

### Scope

`webapp/app/listings/page.tsx`

### Step 1 — Prove API is fast

```bash
curl --http2 -sS -o /dev/null -w "code=%{http_code} time=%{time_total}s\n" \
  --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search"
```

**Look for:** `code=200` and reasonable `time=...`.

### Step 2 — Code review

In `webapp/app/listings/page.tsx`:

- Every async user path ends with `setLoading(false)` in a `finally` (or equivalent).
- Prefer **`aria-busy={loading ? "true" : "false"}`** (strings). Plain boolean `false` often **removes** the attribute so Playwright `toHaveAttribute("aria-busy", "false")` fails.
- Consider **separate** flags (e.g. `resultsLoading` vs `formLoading`) so create/search/detail do not block each other forever.

### Step 3 — Playwright

From **`webapp/`**:

```bash
cd webapp
pnpm exec playwright test e2e/listings-filters-maps.spec.ts
```

Repeat 3 times:

```bash
pnpm exec playwright test e2e/listings-filters-maps.spec.ts --repeat-each=3
```

**Requires:** `E2E_API_BASE=https://off-campus-housing.test`, `NODE_EXTRA_CA_CERTS=../certs/dev-root.pem`, and hostname resolution for `off-campus-housing.test` (see spec v2). Easiest path: `./scripts/run-playwright-e2e-preflight.sh` from repo root.

### Done when

- [ ] `aria-busy` contract satisfied / tests green
- [ ] Three consecutive runs pass (or CI retries configured deliberately)

---

## Issue 3 — Search history save API flow

### Scope

`webapp/lib/api.ts`, `webapp/app/dashboard/page.tsx`, `services/booking-service/src/server.ts`, `services/api-gateway/src/server.ts`

**Endpoints:**

- `POST /api/booking/search-history` (JWT required)
- `GET /api/booking/search-history/list?limit=50` (JWT required)

### Step 1 — Login and capture JWT

```bash
RESP="$(curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -X POST "${EDGE_BASE_HTTPS}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"YOUR_E2E_USER@example.com","password":"YOUR_PASSWORD"}')"

export TOKEN="$(printf '%s' "$RESP" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
test -n "$TOKEN" || { echo "$RESP"; exit 1; }
```

### Step 2 — Save search

```bash
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -X POST "${EDGE_BASE_HTTPS}/api/booking/search-history" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"apartment","minPriceCents":100000,"maxPriceCents":300000}'
```

**Look for:** `HTTP/2 201` (booking returns created row).

### Step 3 — List history

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -H "Authorization: Bearer $TOKEN" \
  "${EDGE_BASE_HTTPS}/api/booking/search-history/list?limit=50"
```

**Look for:** JSON with `"items"` array containing an entry whose `query` / prices match what you posted.

### Step 4 — HTTP/1.1 + HTTP/3

Repeat Step 2–3 with `--http1.1` and `--http3` instead of `--http2` (same URL, headers, body).

### Failure matrix

| Symptom | Cause |
|---------|--------|
| 401 | Missing or invalid `Authorization: Bearer` |
| 500 | Prisma / DB / booking-service error |
| 201 but not in list | Wrong user / wrong `limit` / list endpoint error |

### Done when

- [ ] API list shows the row after POST
- [ ] Dashboard UI shows history after refresh (`webapp/e2e/flows.spec.ts`)

---

## Issue 4 — Retry logic for flaky Playwright tests

### Scope

`webapp/playwright.config.ts`, individual `webapp/e2e/*.spec.ts`

### Step 1 — Config

In `playwright.config.ts`, `retries` is already `process.env.CI ? 1 : 0`; bump CI retries if policy allows (e.g. `2`).

### Step 2 — Prefer `expect.poll` over fixed sleeps

Replace long `sleep` with polling in flaky specs.

### Step 3 — Run

```bash
cd webapp
pnpm exec playwright test --repeat-each=3
```

Or target Franco’s projects:

```bash
pnpm exec playwright test --project=02-auth-booking --project=03-listings --repeat-each=3
```

### Done when

- [ ] Three repeats green on CI or local with same env as preflight

---

## Issue 5 — Disabled search submit button (Dashboard)

### Scope

`webapp/app/dashboard/page.tsx` (`data-testid="search-submit"`)

### Fix direction

Split **initial load** loading from **save action** loading so `disabled={loading}` on the form does not wait forever on `refreshAll()`.

### Validate

```bash
cd webapp
pnpm exec playwright test --project=02-auth-booking e2e/flows.spec.ts
```

**Look for:** test waits for `search-submit` enabled (up to 60s in spec).

---

## Issue 6 — Sorting options (backend + UI)

### Scope

`services/listings-service/src/search-listings-query.ts` (`SEARCH_SORTS`: `created_desc`, `listed_desc`, `price_asc`, `price_desc`)

### Step 1 — HTTP/2

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?sort=price_asc"
```

**Look for:** ascending `price_cents` (nulls last per SQL).

### Step 2 — Determinism (3 identical calls)

```bash
for i in 1 2 3; do
  curl --http2 -sS --cacert "$CA_CERT" \
    --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
    "${EDGE_BASE_HTTPS}/api/listings/search?sort=created_desc" \
    | jq -c '[.items[].id]'
done
```

**Look for:** three lines **byte-identical** (same order and ids).

### Step 3 — HTTP/3

Same URL with `--http3` instead of `--http2`.

### Done when

- [ ] UI sends `sort=` for all four values where applicable (`webapp/lib/api.ts`)

---

## Issue 7 — Distance-based search filter

### Scope (target)

`services/listings-service/src/search-listings-query.ts`, `http-server.ts`

### Current repo note

**`lat` / `lng` / `max_distance_km` are not implemented** on `GET /api/listings/search` today. The listing rows **do** have `latitude` / `longitude` columns for display/create.

### Validation (once implemented)

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?lat=40.7128&lng=-74.0060&max_distance_km=5"
```

**Look for:** only listings within the radius; document the formula (haversine vs PostGIS).

Until then, document **N/A** or open a PR that adds the query params and SQL.

---

## Issue 8 — Search query performance

### Scope

`services/listings-service`, `scripts/perf/explain-listings-search.sh`, k6 scripts under `scripts/load/`

### Step 1 — Baseline k6 (strict edge TLS)

From repo root (adjust script if your wrapper expects different env):

```bash
SSL_CERT_FILE="$PWD/certs/dev-root.pem" \
  ./scripts/k6-exec-strict-edge.sh ./scripts/load/k6-listings-health.js
```

Record **p95** from the summary.

### Step 2 — EXPLAIN

```bash
./scripts/perf/explain-listings-search.sh
```

Default DB: `PGHOST=127.0.0.1` `PGPORT=5442` `PGDATABASE=listings`. Override if your listings Postgres differs:

```bash
PGHOST=127.0.0.1 PGPORT=5442 PGDATABASE=listings ./scripts/perf/explain-listings-search.sh
```

### Step 3 — Optimize + rebuild

```bash
pnpm run rebuild:service:listings
# or
SERVICES=listings-service ./scripts/rebuild-och-images-and-rollout.sh
```

### Step 4 — Re-run k6 and compare p95

### Done when

- [ ] Before/after p95 posted to the issue/PR

---

## Issue 9 — Search result consistency (no duplicate IDs, stable order)

### Step 1 — Three calls, compare ids

```bash
for i in 1 2 3; do
  curl --http2 -sS --cacert "$CA_CERT" \
    --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
    "${EDGE_BASE_HTTPS}/api/listings/search?sort=created_desc" \
    | jq -c '[.items[].id]'
done
```

**Look for:** identical output lines; no duplicate ids **inside** a single response:

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?sort=created_desc" \
  | jq '[.items[].id] | group_by(.) | map(select(length>1)) | length'
```

**Look for:** `0` duplicates.

---

## Issue 10 — Playwright test for search filters

### Target file

`webapp/e2e/search-filters.spec.ts` (new) **or** extend `e2e/listings-filters-maps.spec.ts` / `e2e/flows.spec.ts`.

### Step 1 — Register project (if new file)

Add the spec to the appropriate `testMatch` in `webapp/playwright.config.ts` (e.g. project `03-listings`).

### Step 2 — Run

```bash
cd webapp
pnpm exec playwright test e2e/search-filters.spec.ts
```

### Done when

- [ ] Min price + keyword + sort applied in UI
- [ ] Network response **200** for `/api/listings/search`
- [ ] Assertions on rendered results

---

## Cursor / implementer checklist

1. Use **`EDGE_BASE_HTTPS`** + **`--cacert`** + **`--resolve`** for all edge curls.
2. Use **`--http2`** for HTTP/2 over TLS (not `--http2-prior-knowledge`).
3. Use **`--http3`** only if curl supports it; confirm with `curl -V`.
4. Listings search is **public**; booking history needs **JWT**.
5. **Prices in cents** end-to-end for listings search params.
6. Do not validate production flows with **`http://127.0.0.1:4020`**; use edge or port-forward **service** ports for isolation.

---

## Related files

| Area | Path |
|------|------|
| Listings HTTP | `services/listings-service/src/http-server.ts` |
| Search SQL | `services/listings-service/src/search-listings-query.ts` |
| Gateway | `services/api-gateway/src/server.ts` |
| Booking HTTP | `services/booking-service/src/server.ts` |
| Webapp API client | `webapp/lib/api.ts` |
| Listings page | `webapp/app/listings/page.tsx` |
| Dashboard | `webapp/app/dashboard/page.tsx` |
| Playwright | `webapp/playwright.config.ts`, `webapp/e2e/*.spec.ts` |
