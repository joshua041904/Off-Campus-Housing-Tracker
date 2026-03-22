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

Install browsers once:

```bash
pnpm --filter webapp exec playwright install chromium
```

**Always runnable (no backend):** guest redirect + marketing page.

**Full stack test** (`e2e/flows.spec.ts`): requires `GET {E2E_API_BASE}/api/healthz` to return **200** (default `http://127.0.0.1:4020`). If the gateway is down, that test is **skipped**.

```bash
# optional: custom gateway URL for health check + rewrites inside CI
export E2E_API_BASE=http://127.0.0.1:4020
export API_GATEWAY_INTERNAL=http://127.0.0.1:4020
pnpm --filter webapp test:e2e
```

From repo root:

```bash
pnpm --filter webapp test:e2e
```

**With cluster (integrated E2E):** port-forward `api-gateway` to `127.0.0.1:4020`, wait until `/api/healthz` is 200, then run Playwright (so `flows.spec.ts` and `auth-cycle.spec.ts` are **not** skipped):

```bash
pnpm run test:e2e:integrated
# same as: pnpm run test:e2e:preflight
# or: HOUSING_NS=off-campus-housing-tracker ./scripts/run-playwright-e2e-preflight.sh
```

New specs: `e2e/webapp-pages.spec.ts` (mission, analytics shell, nav), `e2e/auth-cycle.spec.ts` (register → sign out → login → analytics; needs gateway).

## k6 (search + watchlist load)

See `../scripts/load/k6-search-watchlist.js` and `../scripts/load/k6-booking.js`.

```bash
k6 run scripts/load/k6-search-watchlist.js
```

## Features

| Area            | Backend endpoints |
|----------------|-------------------|
| Register / login | `/api/auth/register`, `/api/auth/login` |
| Search history | `POST /api/booking/search-history`, `GET /api/booking/search-history/list` |
| Watchlist      | `POST /api/booking/watchlist/add`, `POST .../remove`, `GET .../list` |

Do not add a `.gitignore` rule that ignores the whole `webapp/` directory or it will stop being tracked.
