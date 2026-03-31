# Off-Campus Housing — Engineering Validation Spec v2

> No ambiguity. No vibes. Only deterministic sauce.

**Plain-text source of truth:** [`Github_issues.txt`](../Github_issues.txt) (same content; edit there or here and keep in sync).

**Companion docs:**

| Doc | Purpose |
|-----|---------|
| [`GITHUB_ISSUES_FILE_MAP.txt`](../GITHUB_ISSUES_FILE_MAP.txt) | Quick path lookup |
| [`GITHUB_ISSUES_ONBOARDING_GUIDE.txt`](../GITHUB_ISSUES_ONBOARDING_GUIDE.txt) | Architecture primer |
| [`FRANCO_SEARCH_UI_VALIDATION.md`](FRANCO_SEARCH_UI_VALIDATION.md) | Franco deep playbook |
| [`Github_issues copy.txt`](../Github_issues%20copy.txt) | Franco text playbook |

This spec defines measurable curls, protocol checks, gateway vs direct isolation, JWT blocks, failure matrices, Done When checklists, and moon issues. Implementation lives in the repo paths cited under each issue.

---

## Table of contents

1. [Engineering validation base](#engineering-validation-base-mandatory)
2. [JWT acquisition block](#jwt-acquisition-block)
3. [Joshua — Listings / Trust / Media](#joshua--listings--trust--media)
4. [Arkar — Auth / Analytics](#arkar--auth--analytics)
5. [Franco — Search / UI / Filters](#franco--search--ui--filters)
6. [Shared + Playwright](#shared--playwright)
7. [Cursor / apply instructions](#cursor--apply-instructions)
8. [Feature → repo files index](#feature--repo-files-index)

---

## Engineering validation base (mandatory)

### Traffic model

Assume this path unless debugging with port-forward:

```text
Client (curl / browser / Playwright)
  → edge (Caddy / ingress TLS termination)
  → api-gateway
  → microservice HTTP (4011 auth, 4012 listings, 4013 booking, …)
```

### Rules

- Do **not** use `http://127.0.0.1:4020` or raw gateway port-forward for validation suites — Playwright and strict scripts reject that legacy pattern.
- Use hostname **`off-campus-housing.test`** + TLS + **`certs/dev-root.pem`** so SNI matches the leaf cert (QUIC / HTTP/3 require correct SNI; avoid `https://<raw-ip>/…` for edge validation unless you also fix SNI via `--resolve`).

### 0) Discover edge IP (MetalLB / ingress / Colima pool)

```bash
kubectl get svc -A | grep LoadBalancer
kubectl get svc -n ingress-nginx
kubectl get svc -n off-campus-housing-tracker
```

Typical Colima MetalLB pool: `192.168.64.240`–`250` (your IP may differ).

### 1) Shell variables (copy-paste — adjust `OCH_EDGE_IP`)

```bash
export REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

export EDGE_HOST="${EDGE_HOST:-off-campus-housing.test}"
export EDGE_PORT="${EDGE_PORT:-443}"
export CA_CERT="${CA_CERT:-$REPO_ROOT/certs/dev-root.pem}"
export OCH_EDGE_IP="${OCH_EDGE_IP:-192.168.64.240}"   # from kubectl / your LB

export EDGE_BASE_HTTPS="https://${EDGE_HOST}"
```

Repeat on every edge curl:

`--cacert "$CA_CERT" --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}"`

### 2) Sanity: edge answers

```bash
curl --http1.1 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/_caddy/healthz"
```

**Success:** `HTTP/1.1` and status **2xx**.

If this fails → stop (ingress, Caddy, wrong IP, or CA mismatch).

### 3) Headless / CI: Node + Playwright need hostname → IP

`curl --resolve` does **not** help Node fetch. Either:

- **A)** `/etc/hosts`:

  ```bash
  sudo sh -c 'grep -qF "${OCH_EDGE_IP} ${EDGE_HOST}" /etc/hosts || echo "${OCH_EDGE_IP} ${EDGE_HOST}" >> /etc/hosts'
  ```

- **B)** `export OCH_AUTO_EDGE_HOSTS=1` — see [`scripts/lib/edge-test-url.sh`](../scripts/lib/edge-test-url.sh)

- **C)** `export OCH_EDGE_IP=<LoadBalancer-IP>` — see [`scripts/run-preflight-scale-and-all-suites.sh`](../scripts/run-preflight-scale-and-all-suites.sh) header

Playwright: [`scripts/run-playwright-e2e-preflight.sh`](../scripts/run-playwright-e2e-preflight.sh) → `edge-test-url.sh`.

### 4) Protocol recipes (HTTP/1.1, HTTP/2, HTTP/3)

**HTTP/1.1**

```bash
curl --http1.1 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/healthz"
```

**HTTP/2 over TLS (ALPN h2 — use `--http2`, NOT `--http2-prior-knowledge`)**

```bash
curl --http2 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/healthz"
```

**HTTP/3 (QUIC)**

```bash
curl --http3 -v --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/_caddy/healthz"
```

**Optional: API path over HTTP/3**

```bash
curl --http3 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/healthz" -o /dev/null -w "%{http_version}\n"
```

**Success:** `http_version` prints `3` (or verbose shows HTTP/3).

### 5) Direct service isolation (gateway vs upstream)

```bash
kubectl port-forward svc/listings-service 4012:4012 -n off-campus-housing-tracker
curl -i http://127.0.0.1:4012/healthz
```

| Observation | Interpretation |
|---------------|----------------|
| Direct **200**, gateway non-200 | `OPEN_ROUTES`, `pathRewrite`, or auth guard order in gateway |
| Direct non-200 | Listings DB / process first |

---

## JWT acquisition block

Use before **any** protected route. Replace email/password with a real test user.

```bash
TOKEN_JSON="$(curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -X POST "${EDGE_BASE_HTTPS}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"ChangeMe123!"}')"

export TOKEN="$(printf '%s' "$TOKEN_JSON" | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)"
test -n "$TOKEN" || { echo "login failed: $TOKEN_JSON"; exit 1; }
```

**Protected call pattern**

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -H "Authorization: Bearer $TOKEN" \
  "${EDGE_BASE_HTTPS}/api/auth/me"
```

**Success:** HTTP/2 **200**, JSON includes claims (e.g. `sub`).

---

## Joshua — Listings / Trust / Media

*Listings correctness, trust integrity, media reliability.*

### Issue: Listings health endpoint must work on all protocols

**Contract:** `GET ${EDGE_BASE_HTTPS}/api/listings/healthz` — public, no JWT.

**HTTP/1.1**

```bash
curl --http1.1 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/healthz"
```

**HTTP/2**

```bash
curl --http2 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/healthz"
```

**HTTP/3**

```bash
curl --http3 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/healthz"
```

**Direct isolation**

```bash
kubectl port-forward svc/listings-service 4012:4012 -n off-campus-housing-tracker
curl -i http://127.0.0.1:4012/healthz
```

| Status | Meaning |
|--------|---------|
| 401 | `OPEN_ROUTES` / healthz bypass missing before JWT guard |
| 404 | Proxy prefix or `pathRewrite` wrong |
| 502/503 | Upstream listings pod not ready |
| 200 + DB warning in JSON | May still be 200 with DB disconnected — read body |

**Repo files:** `services/api-gateway/src/server.ts`, `services/listings-service/src/http-server.ts`

**Done when**

- [ ] HTTP/1.1 → 200
- [ ] HTTP/2 → 200
- [ ] No JWT on edge path
- [ ] HTTP/3 → 200 **or** documented skip (curl without HTTP/3)
- [ ] Direct `/healthz` 200 when listings healthy

---

### Issue: Listing detail by ID (public contract)

**Public URL:** `GET ${EDGE_BASE_HTTPS}/api/listings/listings/${LISTING_ID}`  
**Upstream:** `GET /listings/:id` on listings-service.

```bash
export LISTING_ID="<valid-uuid-from-search>"

curl --http2 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/listings/${LISTING_ID}"
```

**Success:** HTTP/2 **200**, JSON includes `id`, `title`, `price_cents`.

| Status | Meaning |
|--------|---------|
| 401 | `OPEN_ROUTES` missing for `/api/listings/listings/*` |
| 404 | `pathRewrite` / missing row |
| 400 | `validateListingId` (bad UUID) |
| 500 | DB / uncaught exception |

**Repo files:** `services/api-gateway/src/server.ts`, `services/listings-service/src/http-server.ts`, `services/listings-service/src/validation.ts`, `webapp/lib/api.ts`

**Done when**

- [ ] Valid UUID → 200 + row
- [ ] Invalid UUID → 400 (not 500)
- [ ] HTTP/1.1 + HTTP/2 **200** for valid id

---

### Issue: Listing create + analytics sync integrity

1. Obtain JWT — [JWT acquisition block](#jwt-acquisition-block).
2. **Create** (set `EFFECTIVE_FROM` to today’s `YYYY-MM-DD`):

```bash
EFFECTIVE_FROM=$(date +%F)
curl --http2 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -X POST "${EDGE_BASE_HTTPS}/api/listings/create" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"title\":\"Validation spec listing\",\"description\":\"Joshua deterministic create\",\"price_cents\":123000,\"effective_from\":\"${EFFECTIVE_FROM}\",\"pet_friendly\":true,\"smoke_free\":true,\"amenities\":[]}"
```

**Success:** HTTP/2 **201**.

3. **Search**

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?q=Validation%20spec"
```

**Success:** `{ "items": [ … ] }` non-empty.

4. **Daily metrics**

```bash
TODAY="$(date +%F)"
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/analytics/daily-metrics?date=${TODAY}"
```

**Success:** `new_listings` increases vs pre-create snapshot (or team-agreed async bound with Kafka-only).

**Repo files:** `services/listings-service/src/http-server.ts`, `listing-kafka.ts`, `analytics-sync.ts`; `services/analytics-service/src/http-server.ts`, `listing-metrics-projection.ts`, `consumers/listingEventsConsumer.ts`

**Done when**

- [ ] 201 on create
- [ ] Listing visible in search
- [ ] `new_listings` increments (or ≤180s Kafka-only, documented)
- [ ] No unhandled 500 from analytics-sync on happy path

---

### Issue: Trust duplicate flag protection (idempotent abuse report)

Body uses `abuse_target_type` + `target_id` (not bare `listing_id`).

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -X POST "${EDGE_BASE_HTTPS}/api/trust/report-abuse" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"abuse_target_type\":\"listing\",\"target_id\":\"${LISTING_ID}\",\"category\":\"abuse\"}"
```

Run **twice** identically. Today’s schema may allow duplicates; moon fix = UNIQUE or upsert.

**Repo files:** `services/trust-service/src/http-server.ts`, `infra/db/01-trust-schema.sql` + migration

**Done when**

- [ ] Two identical requests → one logical row **or** stable idempotent HTTP response
- [ ] Documented in PR

---

### 🌖 Moon — Listings pagination determinism

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?limit=5&offset=5&sort=created_desc"
```

**Done when:** `len(items) ≤ 5`; three identical calls same order; no duplicate ids; offset windows consistent.

**Repo:** `services/listings-service/src/search-listings-query.ts`, `http-server.ts`

---

### 🌖 Moon — Media metadata integrity

```bash
curl --http2 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -H "Authorization: Bearer $TOKEN" \
  "${EDGE_BASE_HTTPS}/api/media/<id>"
```

Align path with `services/media-service/src/http-server.ts`.

**Done when:** filename, size, content-type visible in response or DB.

---

### 🌖 Moon — Listings SQL performance guard

EXPLAIN (ANALYZE, BUFFERS) on search SQL; index supports `ORDER BY created_at DESC` (or document seq scan at row count *X*).

**Repo:** `scripts/perf/sql`, `services/listings-service/src/search-listings-query.ts`

**Done when:** p95 search latency &lt; baseline (numbers in PR).

---

## Arkar — Auth / Analytics

*Authentication determinism + event reliability.*

### Issue: Auth session persistence across protocols

After login, same token on HTTP/1.1 and HTTP/2:

```bash
curl --http1.1 -sS -o /dev/null -w "%{http_code}\n" --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -H "Authorization: Bearer $TOKEN" \
  "${EDGE_BASE_HTTPS}/api/auth/me"

curl --http2 -sS -o /dev/null -w "%{http_code}\n" --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -H "Authorization: Bearer $TOKEN" \
  "${EDGE_BASE_HTTPS}/api/auth/me"
```

**Success:** `200` and `200`.

| Symptom | Likely cause |
|---------|----------------|
| 401 gateway only | `JWT_SECRET` / issuer mismatch |
| Login OK, `/me` 401 | Wrong Bearer, expired, revoked `jti` |
| Login OK, UI loop | Dashboard vs `localStorage` race |

**Repo files:** `services/api-gateway/src/server.ts`, `services/auth-service/src/server.ts`, `grpc-server.ts`, `webapp/lib/auth-storage.ts`, `webapp/app/login/page.tsx`, `webapp/app/dashboard/page.tsx`

**Done when**

- [ ] `/me` 200 on HTTP/1.1 and HTTP/2
- [ ] Playwright `auth-cycle` passes

---

### Issue: Analytics event propagation timing

Measure Δt from listing **201** until `daily-metrics` shows higher `new_listings`.  
SLA example: ≤5s with `ANALYTICS_SYNC_MODE=1`, or ≤180s Kafka-only.

If exceeded, check: consumer running, topic / `ENV_PREFIX` / isolation suffix, `KAFKA_SSL_*` CA paths.

**Repo:** same as Joshua *Listing create + analytics sync*.

**Done when:** Documented p95 Δt in PR for your env.

---

### 🌖 Moon — JWT expiry handling

- [ ] `GET /api/auth/me` → 401 after expiry
- [ ] `POST /api/auth/refresh` per gateway contract (Bearer = refresh token today — document clients)
- [ ] New access works

**Repo:** `services/api-gateway/src/server.ts`, `services/auth-service`

---

### 🌖 Moon — Rate limit observability

```bash
for i in $(seq 1 40); do
  curl -sS -o /dev/null -w "%{http_code}\n" --cacert "$CA_CERT" \
    --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
    "${EDGE_BASE_HTTPS}/api/healthz" || true
done
```

**Done when:** Eventually **429**; JSON body e.g. `{ "code": "RATE_LIMITED", "message": "…" }` (implement if missing); not HTML.

**Repo:** `services/api-gateway/src/server.ts`

---

### 🌖 Moon — Structured auth logging

Log lines include `userId` (if known), `action`, ISO `timestamp`.

**Done when:** Sample log line in PR.

**Repo:** `services/auth-service/src/server.ts`, `grpc-server.ts`

---

## Franco — Search / UI / Filters

*Frontend state + filter/query correctness.*

> Full step-by-step: [FRANCO_SEARCH_UI_VALIDATION.md](FRANCO_SEARCH_UI_VALIDATION.md)

### Issue: Search filters must map exactly to backend

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?min_price=100000&max_price=200000&sort=price_desc"
```

**Success:** 200; each `price_cents` in `[min_price, max_price]`; descending price; no negative prices.

**Repo:** `webapp/lib/api.ts`, `webapp/app/listings/page.tsx`, `services/listings-service/src/http-server.ts`, `search-listings-query.ts`

---

### Issue: Loading state must clear (`aria-busy`)

React: `aria-busy={false}` often **drops** the attribute — use string `"false"` or split loading flags.

**Done when:** Playwright passes `aria-busy="false"` (listings-filters-maps, flows, guest).

**Repo:** `webapp/app/listings/page.tsx`

---

### 🌖 Moon — Distance filter accuracy

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?lat=40.7128&lng=-74.0060&max_distance_km=5"
```

**Done when:** Only in-radius listings; formula documented. *(Not implemented in search query yet — see Franco doc.)*

---

### 🌖 Moon — Empty result contract

```bash
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/search?min_price=999999999"
```

**Success:** HTTP **200** and `{"items":[]}` — not 500.

**Repo:** `services/listings-service/src/http-server.ts`

---

### 🌖 Moon — k6 search load script

Add `scripts/load/k6-search.js` (or extend `k6-listings.js`) against `${BASE_URL}/api/listings/search`.

**Done when:** p95 in summary; no 5xx under declared VUs/duration.

---

## Shared + Playwright

- Fix one failing spec under `webapp/e2e` (no skip without ticket).
- **E2E:** `E2E_API_BASE=https://off-campus-housing.test`, `NODE_EXTRA_CA_CERTS=certs/dev-root.pem`.
- **DNS:** `OCH_EDGE_IP` + `/etc/hosts` or `OCH_AUTO_EDGE_HOSTS=1` ([§3](#3-headless--ci-node--playwright-need-hostname--ip)).

---

## Cursor — apply instructions

1. Prefer `${EDGE_BASE_HTTPS}` + `--cacert` + `--resolve` for edge curls.
2. Per outward-facing issue: HTTP/1.1 + HTTP/2 + HTTP/3 when curl supports `--http3`.
3. Use `kubectl port-forward` to **service** ports for isolation (not `:4020`).
4. Before protected routes, use [JWT acquisition block](#jwt-acquisition-block).
5. Include failure matrices where HTTP errors apply.
6. “Done when” = checklists, not “seems fine”.
7. Trust `report-abuse`: `abuse_target_type`, `target_id` (+ optional `category`, `details`).
8. Listing create: `title`, `price_cents`, `effective_from` (YYYY-MM-DD); `user_id` from gateway `x-user-id`.

---

## Feature → repo files index

| Area | Paths |
|------|--------|
| Listings | `services/listings-service/src/http-server.ts`, `search-listings-query.ts`, `validation.ts`, `listing-kafka.ts`, `analytics-sync.ts`; `services/api-gateway/src/server.ts`; `webapp/lib/api.ts`; `webapp/app/listings/page.tsx` |
| Auth | `services/auth-service`; `services/api-gateway/src/server.ts`; `webapp/lib/auth-storage.ts`; `webapp/app/login/page.tsx`; `webapp/app/dashboard/page.tsx` |
| Search history | `services/booking-service/src/server.ts`; `webapp/lib/api.ts`; `webapp/app/dashboard/page.tsx` |
| Analytics | `services/analytics-service/src/http-server.ts`, `listing-metrics-projection.ts`, `consumers/listingEventsConsumer.ts` |
| Trust | `services/trust-service/src/http-server.ts`; `infra/db/01-trust-schema.sql` |
| Media | `services/media-service/src/http-server.ts`, `handlers/*`, `db/mediaRepo.ts` |
| E2E | `webapp/e2e/*.spec.ts`; `webapp/playwright.config.ts`; `scripts/run-playwright-e2e-preflight.sh` |
| Load | `scripts/load/k6-*.js`; `scripts/run-housing-k6-edge-smoke.sh` |

---

*End — Engineering Validation Spec v2 (Markdown edition)*
