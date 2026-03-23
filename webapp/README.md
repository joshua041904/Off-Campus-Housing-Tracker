# Webapp (Next.js)

Demo UI for **JWT auth** (via `api-gateway` → auth-service), **search history**, and **watchlist** (booking-service HTTP routes proxied under `/api/booking/*`).

## Local development

1. Start **Postgres bookings** + **api-gateway**, **auth-service**, **booking-service** (e.g. k3s/Colima stack or port-forward gateway to `127.0.0.1:4020`).
2. From repo root:

```bash
pnpm --filter webapp dev
```

Open [http://localhost:3000](http://localhost:3000).

### API base URL

- **Default (recommended for local):** leave `NEXT_PUBLIC_API_BASE` unset. The app calls same-origin `/api/...`; `next.config.mjs` **rewrites** those to `API_GATEWAY_INTERNAL` (default `http://127.0.0.1:4020`), avoiding CORS during dev.
- **Edge / TLS:** set `NEXT_PUBLIC_API_BASE=https://off-campus-housing.test` and ensure your browser trusts the cert (or use curl with `-k` only for debugging).

## Build

```bash
pnpm --filter webapp build
pnpm --filter webapp start
```

## E2E (Playwright)

**E2E and k6 always use the edge hostname** (`https://off-campus-housing.test` by default). **`kubectl port-forward` and `http://127.0.0.1:4020` are not valid E2E targets** — if `E2E_API_BASE` is set to a legacy port-forward URL, scripts normalize it to the https edge. **`API_GATEWAY_INTERNAL` is unset** by Playwright preflight wrappers.

Install browsers once:

```bash
pnpm --filter webapp exec playwright install chromium
```

**Always runnable (no backend):** guest redirect + marketing page (still need the edge URL to load pages).

**Architecture:** `playwright.config.ts` sets **`baseURL`** to **`E2E_API_BASE`** (default **`https://off-campus-housing.test`**) and **`ignoreHTTPSErrors: true`** so Chromium is not blocked by an untrusted dev CA (curl preflight and k6 still verify TLS strictly). It sends **`x-e2e-test: 1`** on every request so **api-gateway** skips the global rate limiter during E2E only. There is **no** Playwright `webServer` — the app must be reachable at that **same https origin** (e.g. Next behind Caddy/ingress). Map the hostname to your MetalLB / LB IP: **`kubectl get svc -n ingress-nginx`**, then **`/etc/hosts`**.

**Preflight gate (recommended):**

```bash
curl --cacert certs/dev-root.pem https://off-campus-housing.test/api/readyz   # expect 200
```

**Full stack tests** (`e2e/flows.spec.ts`, etc.): require `GET {E2E_API_BASE}/api/healthz` → **200**. If the edge is down, those tests are **skipped**.

```bash
export NODE_EXTRA_CA_CERTS="$PWD/certs/dev-root.pem"
export E2E_API_BASE=https://off-campus-housing.test
pnpm --filter webapp test:e2e
```

From repo root:

```bash
pnpm --filter webapp test:e2e
```

**Integrated E2E (preflight):** normalizes **`E2E_API_BASE`**, checks hostname resolves, requires **`certs/dev-root.pem`**, waits on **`curl --cacert … ${E2E_API_BASE}/api/readyz`**, then runs Playwright.

```bash
pnpm run test:e2e:integrated
# same as: pnpm run test:e2e:preflight
# or: ./scripts/run-playwright-e2e-preflight.sh
```

New specs: `e2e/webapp-pages.spec.ts` (mission, analytics shell, nav), `e2e/auth-cycle.spec.ts` (register → sign out → login → analytics; needs edge + gateway).

**Data expectations**

- **Guest listings** (`e2e/guest.spec.ts`): does **not** require seeded rows. An empty listings index (placeholder copy) or at least one listing card both pass.
- **Flows** (`e2e/flows.spec.ts`): creates a user and search history via the UI; the dashboard ignores **stale** parallel `refresh` responses so the history table is not overwritten by a slow initial fetch.
- Optional sanity checks: `GET /api/listings` may return `{ items: [] }` on a fresh DB; `GET /api/booking/search-history/list` with a Bearer token returns rows only after saves.

**Edge + gateway required for:** `e2e/guest.spec.ts` (listings+trust), `e2e/flows.spec.ts`, `e2e/auth-cycle.spec.ts`, `e2e/analytics-api.spec.ts`. Ensure the stack is up and **`off-campus-housing.test`** resolves to your edge.

- **`GET /api/healthz`** only proves the gateway process is up. **Register / gRPC auth** needs **`GET /api/readyz` → 200** (auth-service gRPC verified). If readyz is **503**, Playwright register tests **skip** with a hint — fix auth connectivity, don’t assume “healthz is enough”.
- **POST `/api/analytics/insights/listing-feel` without JWT** needs a **current `api-gateway` image** (OPEN_ROUTES). If the direct API test skips with “auth required”, **rebuild/redeploy api-gateway** from this repo.

**Analytics / Ollama**

- On newer Next.js dev builds you may see a cross-origin warning for `127.0.0.1` → `/_next/*`; configure `allowedDevOrigins` when you upgrade Next (see Next.js release notes).
- Playwright: `e2e/analytics-api.spec.ts` — `GET /api/analytics/daily-metrics`, `POST /api/analytics/insights/listing-feel` (slow; needs gateway + analytics-service; Ollama optional).
- k6: `scripts/load/k6-analytics-public.js` (daily-metrics), `scripts/load/k6-analytics-listing-feel.js` (Ollama path; set `SKIP_ANALYTICS_LISTING_FEEL=1` or `SKIP_K6_ANALYTICS_LISTING_FEEL=1` to skip in grids).

## k6 (search + watchlist load)

Prefer the edge smoke runner (strict TLS, `SSL_CERT_FILE=certs/dev-root.pem`, hostname-only `BASE_URL`):

```bash
./scripts/run-housing-k6-edge-smoke.sh
```

Individual scripts: `../scripts/load/k6-search-watchlist.js`, `../scripts/load/k6-booking.js` (pass `-e BASE_URL=...` or set env).

## Features

| Area            | Backend endpoints |
|----------------|-------------------|
| Register / login | `/api/auth/register`, `/api/auth/login` |
| Search history | `POST /api/booking/search-history`, `GET /api/booking/search-history/list` |
| Watchlist      | `POST /api/booking/watchlist/add`, `POST .../remove`, `GET .../list` |

Do not add a `.gitignore` rule that ignores the whole `webapp/` directory or it will stop being tracked.
