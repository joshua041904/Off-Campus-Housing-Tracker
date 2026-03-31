# Arkar — Platform, auth & analytics validation playbook

**Owner:** Arkar  

Playbook for **Arkar’s** backlog (Kafka, analytics, auth). [`Github_issues copy.txt`](../Github_issues%20copy.txt) may currently track **Joshua** — if so, use [`JOSHUA_ISSUES_PLAYBOOK.md`](JOSHUA_ISSUES_PLAYBOOK.md) for that text file.

**Related:** [Engineering Validation Spec v2](../Github_issues.txt) · [`FRANCO_SEARCH_UI_VALIDATION.md`](FRANCO_SEARCH_UI_VALIDATION.md) · [`FRANCO_ISSUES_PLAYBOOK.md`](FRANCO_ISSUES_PLAYBOOK.md) · [`JOSHUA_ISSUES_PLAYBOOK.md`](JOSHUA_ISSUES_PLAYBOOK.md).

---

## Overview

This playbook is **self-contained** for Arkar’s backlog: every issue has **why**, **scope**, **files**, **commands**, **success criteria**, **debug**, **checkbox verification**, and **done when**.

### Event / analytics / auth flow (mental model)

```text
Listings (and other producers)
  → Kafka (TLS, agreed topic names + optional OCH_KAFKA_TOPIC_SUFFIX)
  → analytics-service consumer → Postgres analytics.daily_metrics
  → GET /daily-metrics (via gateway: /api/analytics/daily-metrics?date=…)

Browser / Playwright
  → edge (Caddy TLS, hostname off-campus-housing.test)
  → api-gateway
  → auth (HTTP /api/auth/*) | analytics (HTTP /api/analytics/*) | listings | …
```

### Why we validate this way

- **Edge + TLS + SNI** match production: use `https://off-campus-housing.test` with `certs/dev-root.pem`, not raw IP URLs that break hostname verification.
- **`--resolve HOST:443:LB_IP`** pins the IP without disabling cert checks (same idea as Franco playbook).
- **Do not** rely on legacy `http://127.0.0.1:4020` for “real” validation; Playwright’s config already normalizes away that pattern — see `webapp/playwright.config.ts`.
- **Kafka path**: producer, broker, consumer, and DB must be checked **together** for delay/missing-metrics issues.

---

## Table of contents

1. [Step 0 — Environment](#step-0--environment)
2. [Step 0a — Sanity checks](#step-0a--sanity-checks)
3. [Contracts — analytics, auth, webapp](#contracts--analytics-auth-webapp)
4. [Issue 1 — Fix event pipeline delay or failure](#issue-1--fix-event-pipeline-delay-or-failure)
5. [Issue 2 — Fix analytics `daily_metrics` not updating](#issue-2--fix-analytics-daily_metrics-not-updating)
6. [Issue 3 — Fix login redirect after authentication](#issue-3--fix-login-redirect-after-authentication)
7. [Issue 4 — Improve test debugging output](#issue-4--improve-test-debugging-output)
8. [Issue 5 — Ensure auth session persistence](#issue-5--ensure-auth-session-persistence)
9. [Issue 6 — Improve structured logging in auth-service](#issue-6--improve-structured-logging-in-auth-service)
10. [Issue 7 — Add test for `daily_metrics` increment](#issue-7--add-test-for-daily_metrics-increment)
11. [Issue 8 — Ensure analytics events fire correctly](#issue-8--ensure-analytics-events-fire-correctly)
12. [Issue 9 — Validate token refresh flow](#issue-9--validate-token-refresh-flow)
13. [Issue 10 — Normalize auth error responses](#issue-10--normalize-auth-error-responses)
14. [Issue 11 — Analytics event logging validation (event layer)](#issue-11--analytics-event-logging-validation-event-layer)
15. [Issue 12 — Auth service stability, logging & errors (post-PR1)](#issue-12--auth-service-stability-logging--errors-post-pr1)
16. [Appendix — PR1 baseline (from backlog)](#appendix--pr1-baseline-from-backlog)
17. [Global debug cheat sheet](#global-debug-cheat-sheet)
18. [Cursor / implementer rules](#cursor--implementer-rules)
19. [Repo file index](#repo-file-index)

---

## Step 0 — Environment

Run once per shell, from **repo root**, whenever you hit the **edge** with `curl` (auth, analytics, listings through gateway).

### Commands

```bash
cd "$(git rev-parse --show-toplevel)"

export EDGE_HOST="${EDGE_HOST:-off-campus-housing.test}"
export EDGE_PORT="${EDGE_PORT:-443}"
export CA_CERT="${CA_CERT:-$PWD/certs/dev-root.pem}"
# MetalLB / ingress EXTERNAL-IP for your cluster, e.g.:
#   kubectl get svc -A | grep LoadBalancer
export OCH_EDGE_IP="${OCH_EDGE_IP:-192.168.64.240}"

export EDGE_BASE_HTTPS="https://${EDGE_HOST}"
```

Every edge `curl` in this doc should include:

```bash
--cacert "$CA_CERT" --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}"
```

### Success

| Check | Expected |
|--------|-----------|
| CA present | `test -s "$CA_CERT"` succeeds (or run `./scripts/dev-generate-certs.sh`) |
| IP correct | `OCH_EDGE_IP` matches LoadBalancer / NodePort target you actually use |

### Debug

| Problem | Action |
|--------|--------|
| CA missing | `./scripts/dev-generate-certs.sh` · `ls -l certs/dev-root.pem` |
| Wrong IP | `kubectl get svc -n off-campus-housing-tracker \| grep -E 'LoadBalancer|NodePort'` |
| `curl: (60)` cert error | URL host must be `EDGE_HOST`, not raw IP; keep `--cacert` |

### Environment checklist

- [ ] Repo root identified; `CA_CERT` points at dev root CA.
- [ ] `OCH_EDGE_IP` updated for **this** cluster/session.
- [ ] Optional: `/etc/hosts` maps `EDGE_HOST` → `OCH_EDGE_IP` for browsers without `--resolve`.

---

## Step 0a — Sanity checks

**Why:** Before debugging Kafka or auth, confirm **edge → gateway → public routes** respond.

### Caddy / edge liveness (HTTP/1.1)

```bash
curl --http1.1 -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/_caddy/healthz"
```

**Success:** HTTP **2xx**.

### Analytics health via gateway (HTTP/2)

```bash
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/analytics/healthz"
```

**Success:** **200**; JSON includes `"ok": true` (DB may warn if disconnected — note for Issues 1–2).

### Listings health (needed before “create listing” in many flows)

```bash
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/listings/healthz"
```

**Success:** **200** (JSON may warn if DB down).

### Daily metrics read (baseline for Issues 2, 7, 8, 11)

```bash
TODAY="$(date +%F)"
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/analytics/daily-metrics?date=${TODAY}"
```

**Success:** **200** JSON with `date`, `new_listings`, etc. (zeros are valid if nothing happened yet).

### Step 0a checklist

- [ ] Edge healthz **2xx**.
- [ ] Analytics healthz **200**.
- [ ] Listings healthz **200** (if you will create listings).
- [ ] `daily-metrics` returns JSON for `date=YYYY-MM-DD`.

### Debug

| Symptom | Likely cause |
|--------|----------------|
| 404 on `/api/analytics/*` | Gateway routing — `services/api-gateway/src/server.ts` |
| 502 / timeout | Upstream pod not ready; check `kubectl get pods -n off-campus-housing-tracker` |
| Analytics `db: disconnected` | Postgres URL / network for `analytics-service` |

---

## Contracts — analytics, auth, webapp

**Why:** Implementers and testers must agree on **paths**, **query params**, and **storage**.

### Analytics (HTTP)

| Item | Detail |
|------|--------|
| **Gateway paths** | `GET /api/analytics/healthz`, `GET /api/analytics/daily-metrics?date=YYYY-MM-DD` |
| **Upstream** | `analytics-service` HTTP (see `ANALYTICS_HTTP` in gateway); app routes `/healthz`, `GET /daily-metrics` |
| **Implementation** | `services/analytics-service/src/http-server.ts` · gateway: `services/api-gateway/src/server.ts`, `proxy-limits.ts` (daily-metrics coalescing) |

### Listings events → metrics

| Item | Detail |
|------|--------|
| **Kafka** | Shared client: `services/common/src/kafka.ts`; listings producer: `services/listings-service/src/listing-kafka.ts` |
| **Consumer** | `services/analytics-service/src/consumers/listingEventsConsumer.ts` |
| **Projection** | `services/analytics-service/src/listing-metrics-projection.ts` → `analytics.daily_metrics` |
| **Isolation** | `OCH_KAFKA_TOPIC_SUFFIX` must match between producers and consumers |

### Auth (HTTP via gateway)

| Item | Detail |
|------|--------|
| **Login** | `POST ${EDGE_BASE_HTTPS}/api/auth/login` · JSON `{"email","password"}` |
| **Refresh** | `POST` to auth-service `/refresh` (confirm gateway exposure in `api-gateway`; gRPC also has refresh in `auth-service`) |
| **Implementation** | `services/auth-service/src/server.ts`, `grpc-server.ts` |

### Webapp

| Item | Detail |
|------|--------|
| **Login UX** | `webapp/app/login/page.tsx` → `loginUser()` → `router.push("/dashboard")` |
| **Token storage** | `webapp/lib/auth-storage.ts` (localStorage) |
| **API helper** | `webapp/lib/api.ts` |

### Event-layer automation

| Script | Role |
|--------|------|
| `./scripts/run-event-layer-verification.sh` | Vitest `event-layer-verification` + proto/topic verify + partition check |
| `./scripts/test-auth-service.sh` | Broad auth HTTP/MFA exercise (see script header for `HOST` / `PORT` / `TARGET_IP`) |
| `./scripts/test-housing-stack-wiring.sh` | Gateway ↔ services smoke |

### Rebuild matrix (after code changes)

| What you changed | Command |
|------------------|---------|
| Webapp + default stack | `./scripts/rebuild-housing-colima.sh` or `pnpm run rebuild:housing:colima` |
| One backend only | `SERVICES=<name> ./scripts/rebuild-och-images-and-rollout.sh` or `pnpm run rebuild:service:<short>` |
| Several backends (no webapp) | `SERVICES="svc1 svc2" ./scripts/rebuild-och-images-and-rollout.sh` |
| Webapp + multiple backends | `SERVICES="..." ./scripts/rebuild-housing-colima.sh` |
| **analytics-service only** | `pnpm run rebuild:service:analytics` or `SERVICES=analytics-service ./scripts/rebuild-och-images-and-rollout.sh` |
| **auth-service only** | `pnpm run rebuild:service:auth` |
| **auth + api-gateway** | `SERVICES="auth-service api-gateway" ./scripts/rebuild-och-images-and-rollout.sh` |

---

## Issue 1 — Fix event pipeline delay or failure

**Plain-text source:** “Fix event pipeline delay or failure Arkar” — Scope: Kafka + analytics-service.

### Why

Distributed debugging: delay or failure anywhere in **produce → broker → consume → DB** breaks trust in metrics and SLOs.

### Scope

- Kafka brokers, topics, consumer groups
- Producers (e.g. `listings-service`) and `analytics-service` consumers
- Postgres `analytics` schema

### Files & entrypoints

| Area | Path |
|------|------|
| Kafka TLS / topics | `services/common/src/kafka.ts`, `services/common/src/kafka-wait.ts` |
| Listings producer | `services/listings-service/src/listing-kafka.ts` |
| Consumer | `services/analytics-service/src/consumers/listingEventsConsumer.ts` |
| Server startup | `services/analytics-service/src/server.ts` |
| Infra | `infra/**`, `docker-compose.yml` (local) |

### Step 1 — Confirm analytics consumer is running

```bash
kubectl get pods -n off-campus-housing-tracker -l app.kubernetes.io/name=analytics-service 2>/dev/null || true
kubectl logs -n off-campus-housing-tracker deploy/analytics-service --tail=200 2>/dev/null || true
```

**Success:** Pods **Running**; logs show consumer connect or steady heartbeat (no crash loop).

### Step 2 — Confirm producer path when a listing is created

Use your normal path (UI, E2E, or API). Then check **listings** and **analytics** logs for errors in the same time window.

**Success:** No repeated publish failures; consumer log shows processing within your **timeout SLO**.

### Step 3 — Optional: consumer lag (cluster with CLI access)

If your environment exposes Kafka admin tools, check **lag** for the analytics consumer group on the listing-events topic. Exact command depends on ops setup (Strimzi, shell in broker pod, etc.).

**Success:** Lag **near zero** after bounded wait following a known event.

### Debug matrix

| Symptom | Likely cause |
|--------|----------------|
| Consumer never connects | `KAFKA_*` TLS paths, wrong broker address, `KAFKA_SSL_ENABLED` |
| Wrong topic / empty | `LISTING_EVENTS_TOPIC`, `OCH_KAFKA_TOPIC_SUFFIX` mismatch |
| Lag grows forever | Consumer exceptions, poison message, DB down |
| Delay only under load | Partitions, replicas, `ANALYTICS_HTTP_MAX_CONCURRENT` / 503 on internal ingest |

### Verification checklist

- [ ] Listing (or configured) **producer** logs show successful publish (or documented retry behavior).
- [ ] Broker / topic configuration matches **proto** / `verify-proto-events-topics.sh` expectations.
- [ ] `analytics-service` consumer **processes** without tight error loop.
- [ ] **E2E:** create listing → within team **timeout**, `daily_metrics` or downstream API reflects activity.
- [ ] **Optional failure injection:** mis-TLS or broker pause → logs explain root cause; recovery does not corrupt DB.

### Done when

Metrics (or offsets) update within the agreed **timeout** under normal load; failures are explainable from logs and runbooks.

---

## Issue 2 — Fix analytics `daily_metrics` not updating

**Plain-text source:** “Fix analytics daily_metrics not updating Arkar” — Scope: analytics-service + Kafka.

### Why

Event-driven correctness: `ListingCreated` (and related paths) must **project** into `analytics.daily_metrics`.

### Scope

- `analytics-service` consumer + projection
- Optional: listings-service producer and internal HTTP ingest (`ANALYTICS_SYNC_MODE`)

### Files

| Path | Role |
|------|------|
| `services/analytics-service/src/listing-metrics-projection.ts` | Idempotent UPSERT into `daily_metrics` |
| `services/analytics-service/src/consumers/listingEventsConsumer.ts` | Kafka → projection |
| `services/analytics-service/src/http-server.ts` | `GET /daily-metrics`, internal ingest when enabled |

### Step 1 — Baseline `new_listings` for today

```bash
TODAY="$(date +%F)"
curl --http2 -sS --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  "${EDGE_BASE_HTTPS}/api/analytics/daily-metrics?date=${TODAY}"
```

Record `new_listings` (or full JSON).

### Step 2 — Create one listing (product path)

Use webapp, `listing-and-analytics-journey` E2E, or authenticated listings API — whichever matches your environment.

### Step 3 — Re-query after bounded wait

Wait **N seconds** (define N with your team; e.g. 30–120s depending on Kafka + consumer). Repeat Step 1.

**Success:** `new_listings` (or relevant column) **≥** prior value; strict equality **+1** if only one listing event counted.

### Step 4 — Run event-layer verification

```bash
cd "$(git rev-parse --show-toplevel)"
./scripts/run-event-layer-verification.sh
```

**Success:** Script exits **0** or skips are **documented** (`SKIP_*` env vars in script header).

### Debug matrix

| Symptom | Likely cause |
|--------|----------------|
| Always zero | Consumer not running; wrong topic; SSL env |
| Ingest 404 | `ANALYTICS_SYNC_MODE` not `1` for internal HTTP path |
| 503 on public routes | Concurrency guard; see comment in `http-server.ts` re internal ingest |

### Verification checklist

- [ ] **Create listing** triggers expected event path (Kafka and/or internal ingest, per deployment).
- [ ] **Idempotency:** duplicate delivery does not corrupt counts (code review + spot test).
- [ ] **HTTP:** `GET /api/analytics/daily-metrics?date=…` reflects update.
- [ ] `./scripts/run-event-layer-verification.sh` green or intentionally skipped with reason.

### Done when

**Metrics increment after listing create**; repeatable on a clean run.

---

## Issue 3 — Fix login redirect after authentication

**Plain-text source:** “Fix login redirect after authentication Arkar” — Scope: webapp + auth-service.

### Why

Classic auth UX: after successful login, user must land on **`/dashboard`** (register flow typically the same).

### Scope

- `webapp` login/register pages
- Gateway + `auth-service` login contract (`token` in JSON)

### Files

| Path | Role |
|------|------|
| `webapp/app/login/page.tsx` | `router.push("/dashboard")` after token |
| `webapp/app/register/page.tsx` | Same redirect pattern |
| `webapp/lib/api.ts` | `loginUser` → `/api/auth/login` |
| `services/auth-service/src/server.ts` | Login handler |
| `services/api-gateway/src/server.ts` | `/api/auth/login` proxy |

### Step 1 — API-level login (isolates gateway + auth)

```bash
curl --http2 -sS -i --cacert "$CA_CERT" \
  --resolve "${EDGE_HOST}:${EDGE_PORT}:${OCH_EDGE_IP}" \
  -H "Content-Type: application/json" \
  -d '{"email":"YOUR_USER@example.com","password":"YOUR_PASSWORD"}' \
  "${EDGE_BASE_HTTPS}/api/auth/login"
```

**Success:** **200**; JSON body includes `"token":"..."` (length > 0).

### Step 2 — Browser / Playwright

1. Open `https://off-campus-housing.test/login` (with trust CA / ignore cert per env).
2. Submit valid non-MFA credentials.
3. Observe URL and page.

**Success:** URL ends with **`/dashboard`**; dashboard content visible (not login).

### Step 3 — Negative cases

- Wrong password → stay on login; error message; **no** token in `localStorage` for new session.
- MFA-required account → webapp shows **clear** error (`loginUser` throws MFA message today — document if intentional).

### Debug matrix

| Symptom | Likely cause |
|--------|----------------|
| 401/502 on login | Auth pod, gateway proxy, wrong `HOST`/`PORT` in curl |
| Token but no redirect | `webapp/app/login/page.tsx` / router |
| Flash then kicked to login | Token not stored — `webapp/lib/auth-storage.ts` |

### Verification checklist

- [ ] Valid login → **`/dashboard`** (URL + UI).
- [ ] Register → **`/dashboard`** when token returned.
- [ ] Bad password → error; no partial auth state.
- [ ] MFA-required behavior **documented** and tested if applicable.
- [ ] Playwright **`02-auth-booking`** or relevant spec passes if you touch redirect logic.

### Done when

**Login → `/dashboard`** for standard test users; failures visible and safe.

---

## Issue 4 — Improve test debugging output

**Plain-text source:** “Improve test debugging output Arkar” — Scope: webapp/e2e.

### Why

Failing E2E must give **actionable** output so the whole team can commit confidently.

### Scope

- `webapp/e2e/**/*.spec.ts`
- `webapp/playwright.config.ts` (`reporter`, `trace`, `timeout`)

### Files

| Path | Role |
|------|------|
| `webapp/playwright.config.ts` | `reporter`, `use.trace`, `timeout`, `workers` |
| `webapp/playwright.global-setup.ts` | Global preconditions |
| `.github/workflows/*.yml` | CI artifact upload for reports |

### Step 1 — Local run with HTML report

```bash
cd "$(git rev-parse --show-toplevel)/webapp"
pnpm run test:e2e -- --reporter=list,html
```

**Success:** `playwright-report/` generated; open `index.html` and confirm failure shows **step + error**.

### Step 2 — Headed reproduction

```bash
pnpm run test:e2e:headed -- e2e/path/to/spec.ts
```

**Success:** Human-observable failure matches CI symptom.

### Step 3 — Stricter edge / integrity (when relevant)

```bash
pnpm run test:e2e:strict-verticals-and-integrity
```

(Heavy; use when changing gateway, transport, or system-integrity.)

### Debug matrix

| Symptom | Action |
|--------|--------|
| Timeout only in CI | Increase trace retention; log `baseURL` from config |
| No screenshot | Enable `E2E_SCREENSHOTS=1` project or `screenshot: 'only-on-failure'` |

### Verification checklist

- [ ] Failure output includes **URL**, **assertion**, and **last known page state** (trace/screenshot where enabled).
- [ ] **Trace on first retry** (current config) — confirm artifacts path documented for CI.
- [ ] **grep-friendly** log prefixes for major flows (if you add logging in tests).
- [ ] One **forced failure** still produces useful artifacts.

### Done when

Failing tests show **useful logs**; review agrees.

---

## Issue 5 — Ensure auth session persistence

**Plain-text source:** “Ensure auth session persistence Arkar” — Scope: auth-service (tokens) + webapp (storage).

### Why

JWT/session correctness: user should stay authenticated across **in-app navigations** and **hard refresh** while token is valid.

### Scope

- `webapp/lib/auth-storage.ts`, `webapp/lib/api.ts`
- Token TTL / refresh behavior in `auth-service`

### Files

| Path | Role |
|------|------|
| `webapp/lib/auth-storage.ts` | `getStoredToken` / `setStoredToken` |
| `webapp/app/dashboard/page.tsx` | Redirect if no token |
| `services/auth-service/src/server.ts` | JWT issue / refresh |

### Step 1 — Manual navigation matrix

After login:

1. Open **Listings**, **Mission**, **Dashboard** from nav.
2. Hard refresh on **`/dashboard`** (`Cmd+Shift+R` / `Ctrl+Shift+R`).

**Success:** Nav still shows user; dashboard loads after refresh **if** token still valid.

### Step 2 — Expiry behavior

Simulate or wait for expiry (or use short-lived test token if you have tooling).

**Success:** User is sent to **login** or **refresh** runs — behavior matches **documented product intent**.

### Step 3 — Sign out

Click **Sign out** (`Nav` → `clearStoredToken`).

**Success:** Next visit to `/dashboard` redirects to **`/login`**; storage cleared.

### Debug matrix

| Symptom | Likely cause |
|--------|----------------|
| Lost session on refresh | Storage cleared, different subdomain, private mode |
| Infinite redirect | Token present but invalid — gateway returns 401 |

### Verification checklist

- [ ] Login → multi-page nav → still authenticated.
- [ ] Hard refresh on `/dashboard` preserves session when token valid.
- [ ] Expired token behavior **matches spec** (logout vs refresh).
- [ ] Sign out clears token and guards protected routes.

### Done when

User **stays logged in** across pages for valid tokens; expiry consistent.

---

## Issue 6 — Improve structured logging in auth-service

**Plain-text source:** “Issue: Improve structured logging in auth-service Arkar”.

### Why

Operations need **userId** (or `sub`) and **action** on auth events without leaking secrets.

### Scope

`services/auth-service` HTTP + gRPC paths.

### Files

| Path | Role |
|------|------|
| `services/auth-service/src/server.ts` | HTTP login, register, refresh |
| `services/auth-service/src/grpc-server.ts` | gRPC auth methods |

### Step 1 — Implement structured fields

Add consistent fields (JSON logs or key=value) for: login success, login failure, register.

### Step 2 — Run auth test script

```bash
cd "$(git rev-parse --show-toplevel)"
./scripts/test-auth-service.sh
```

Adjust `HOST`, `PORT`, `TARGET_IP` / `USE_LB_FOR_TESTS` per script header if not default.

**Success:** Script **exits 0**; pod logs show new structured lines.

### Step 3 — Grep logs

```bash
kubectl logs -n off-campus-housing-tracker deploy/auth-service --tail=300 | head -100
```

**Success:** Lines parseable; **no** raw passwords.

### Verification checklist

- [ ] Login **success** logs include `userId` or `sub` + action.
- [ ] Login **failure** logs reason class **without** password.
- [ ] **Register** logs structured signup event.
- [ ] Matches team log aggregation convention (JSON vs text).
- [ ] `test-auth-service.sh` still passes.

### Done when

Logs **readable and consistent**; sample lines in GitHub issue.

---

## Issue 7 — Add test for `daily_metrics` increment

**Plain-text source:** “Issue: Add test for daily_metrics increment Arkar”.

### Why

Regression guard for Issue 2 — automation should fail if projection breaks.

### Scope

- `services/analytics-service` tests and/or integration with listings/Kafka
- Possibly `services/event-layer-verification` if contract-level

### Files (starting points)

| Path | Role |
|------|------|
| `services/analytics-service/` | Unit/integration tests |
| `services/event-layer-verification/` | Kafka / contract tests |
| `webapp/e2e/listing-and-analytics-journey.spec.ts` | UI journey touching analytics |

### Step 1 — Find or add targeted test

Locate existing analytics tests; extend with **before/after** `new_listings` or consumer mock.

### Step 2 — Run analytics + event-layer packages

```bash
cd "$(git rev-parse --show-toplevel)"
pnpm --filter analytics-service test
./scripts/run-event-layer-verification.sh
```

**Success:** New assertion fails on broken projection and passes on main.

### Verification checklist

- [ ] Test **creates** listing or emits fixture event.
- [ ] Asserts **metric** or **API** response increased appropriately.
- [ ] **Deterministic** (no flake from date races — pin date or mock clock if needed).
- [ ] Documented command for **CI** / local.

### Done when

**Test passes** in CI or documented `pnpm` command.

---

## Issue 8 — Ensure analytics events fire correctly

**Plain-text source:** “Issue: Ensure analytics events fire correctly Arkar”.

### Why

Events must carry **type**, **timestamp**, and **userId** (when available) for downstream analytics and debugging.

### Scope

- Producers and consumers under `analytics-service` and upstream services
- `services/event-layer-verification`

### Step 1 — Trigger login + listing creation

Use same stack as production-like dev (edge or documented port-forward).

### Step 2 — Run verification script

```bash
cd "$(git rev-parse --show-toplevel)"
./scripts/run-event-layer-verification.sh
```

### Step 3 — Inspect logs / capture output

Attach **script stdout** and relevant **pod logs** to the issue.

**Success:** Events show **type**, **timestamp**, **actor** where spec requires.

### Verification checklist

- [ ] **Login** path emits expected event(s) (if in scope).
- [ ] **Listing create** emits expected event(s).
- [ ] Payload fields match **proto** / internal schema.
- [ ] **Invalid** payloads log **warning/error** once implemented.
- [ ] **Output attached** to GitHub issue.

### Done when

Verification **output attached**; field list agreed with schema.

---

## Issue 9 — Validate token refresh flow

**Plain-text source:** “Issue: Validate token refresh flow Arkar”.

### Why

Clients must recover when the **access** token expires using **refresh** (HTTP and/or gRPC).

### Scope

`services/auth-service` — `POST /refresh` and gRPC `RefreshToken`.

### Files

| Path | Role |
|------|------|
| `services/auth-service/src/server.ts` | HTTP `/refresh` |
| `services/auth-service/src/grpc-server.ts` | `RefreshToken` |

### Step 1 — Login to obtain tokens

Use `curl` on `/api/auth/login` (Issue 3) or `test-auth-service.sh`. Confirm response includes **refresh** token if your API returns it (inspect JSON).

### Step 2 — Call refresh with refresh token

If gateway exposes refresh HTTP route, mirror gateway pattern (grep `refresh` in `api-gateway/src/server.ts`). Example pattern against **direct** auth HTTP (port-forward if needed):

```bash
# Example only — adjust URL/port to your environment after kubectl port-forward svc/auth-service ...
# curl -sS -X POST "http://127.0.0.1:PORT/refresh" -H "Content-Type: application/json" \
#   -d '{"refresh_token":"..."}'
```

**Success:** **200** and new **access** token; or documented gRPC flow succeeds.

### Step 3 — Negative test

Send **invalid** or **expired** refresh token.

**Success:** Stable **4xx** + **consistent** JSON error body (ties to Issue 10).

### Verification checklist

- [ ] **Happy path:** expired access → refresh → valid access.
- [ ] **Invalid refresh** → clear error, no stack leak.
- [ ] **Gateway** behavior documented (path, headers).
- [ ] gRPC path documented if mobile/internal clients use it.

### Done when

Flow works **manually** or via automated test; notes in issue.

---

## Issue 10 — Normalize auth error responses

**Plain-text source:** “Issue: Normalize auth error responses Arkar”.

### Why

All clients expect a **single shape**, e.g. `{ "code", "message" }`, across **invalid login**, **expired token**, **missing token**.

### Scope

- `auth-service` HTTP handlers
- `api-gateway` if it maps or wraps errors

### Files

| Path | Role |
|------|------|
| `services/auth-service/src/server.ts` | HTTP errors |
| `services/auth-service/src/grpc-server.ts` | gRPC status details |
| `services/api-gateway/src/server.ts` | Auth routes, proxies |

### Step 1 — Matrix test with curl

For each case, capture **status** + **JSON body**:

| Case | Suggested curl direction |
|------|---------------------------|
| Invalid login | `POST /api/auth/login` bad password |
| Missing token | `GET` protected route without `Authorization` |
| Expired token | `Authorization: Bearer <expired>` |

**Success:** Same top-level keys and stable HTTP status policy (401 vs 403 documented).

### Step 2 — Run stack scripts

```bash
./scripts/test-auth-service.sh
./scripts/test-housing-stack-wiring.sh
```

**Success:** Both pass or failures **only** from known gaps tracked in issue.

### Verification checklist

- [ ] Invalid login → normalized body.
- [ ] Expired token → normalized body.
- [ ] Missing token → normalized body.
- [ ] MFA / validation errors → normalized where applicable.
- [ ] **Example JSON** per class attached to issue.

### Done when

**Consistent** responses; samples in issue.

---

## Issue 11 — Analytics event logging validation (event layer)

**Plain-text source:** “Add Analytics Event Logging Validation Arkar” + rebuild matrix in txt.

### Why

After **analytics-service** changes, rebuild and prove **events** and **contracts** still hold.

### Scope

- Rebuild **analytics-service**
- Trigger: register/login, create listing
- Run `./scripts/run-event-layer-verification.sh`
- Implementation: warn/error logs for bad payload shape

### Files

| Path | Role |
|------|------|
| `./scripts/run-event-layer-verification.sh` | Orchestration |
| `services/event-layer-verification/` | Vitest tests |
| `./scripts/verify-proto-events-topics.sh` | Proto ↔ topic |
| `./scripts/verify-kafka-event-topic-partitions.sh` | Partitions |

### Step 1 — Rebuild analytics only

```bash
cd "$(git rev-parse --show-toplevel)"
pnpm run rebuild:service:analytics
# or: SERVICES=analytics-service ./scripts/rebuild-och-images-and-rollout.sh
```

### Step 2 — Rollout healthy

```bash
kubectl rollout status deploy/analytics-service -n off-campus-housing-tracker --timeout=180s
```

**Success:** Rollout **success**.

### Step 3 — Trigger actions

Register/login and create listing against **edge** (Step 0a).

### Step 4 — Run event-layer verification

```bash
./scripts/run-event-layer-verification.sh
```

### Step 5 — Validate fields

Confirm events include **type**, **timestamp**, **userId** when available (logs, test output, or message capture).

### Debug matrix

| Symptom | Action |
|--------|--------|
| Vitest fails | Run `pnpm --filter event-layer-verification run test` alone |
| Proto verify fails | `./scripts/verify-proto-events-topics.sh` |
| Partition verify warns | Kafka not ready — `SKIP_PARTITION_VERIFY=1` only with issue note |

### Verification checklist

- [ ] Rebuild + rollout **healthy**.
- [ ] Register/login + listing created in **this** environment.
- [ ] `./scripts/run-event-layer-verification.sh` **green** or skips **documented**.
- [ ] Emitted events include **type**, **timestamp**, **actor** when required.
- [ ] Bad payloads **log clearly** (implementation).
- [ ] **Verification output** attached to GitHub issue.

### Done when

Output **attached**; invalid/missing events **detectable**.

---

## Issue 12 — Auth service stability, logging & errors (post-PR1)

**Plain-text source:** “After PR1 complete…” block + “Improve Auth Service Stability & Logging Arkar” (merged here).

### Why

Single place for **logging + error shape + test scripts** after PR1 baseline exists.

### Scope

`services/auth-service`; `api-gateway` only if normalizing responses.

### Step 1 — Rebuild

```bash
pnpm run rebuild:service:auth
# If gateway changed:
# SERVICES="auth-service api-gateway" ./scripts/rebuild-och-images-and-rollout.sh
```

### Step 2 — Logging

Add structured logs: login success, login failure, signup/register.

### Step 3 — Error responses

Consistent **HTTP status** + **JSON** for invalid/expired/missing token.

### Step 4 — Run tests

```bash
./scripts/test-auth-service.sh
./scripts/test-housing-stack-wiring.sh
```

### Verification checklist

- [ ] Logs: login success / failure / register with structured fields.
- [ ] Invalid token → logged + normalized client error.
- [ ] Expired token → logged + normalized client error.
- [ ] Status codes **documented** (401 vs 403).
- [ ] Both scripts **pass** or failures explained in issue.
- [ ] **Sample error JSON** in issue.

### Done when

Test output + samples in issue; auth outcomes **visible** in logs.

---

## Appendix — PR1 baseline (from backlog)

The plain-text backlog references **PR1** context. Treat as **already satisfied** for new work unless you are bootstrapping a **new** cluster:

- [ ] First-time cluster / TLS / preflight path documented (e.g. `GITHUB_PR_DESCRIPTION.txt`, section 4).
- [ ] Canonical rebuild scripts exist: `scripts/rebuild-housing-colima.sh`, `scripts/rebuild-och-images-and-rollout.sh`.
- [ ] Cert / JKS bootstrap automated in preflight for first-time setup.

---

## Global debug cheat sheet

| Problem | Where to look |
|---------|----------------|
| Kafka TLS | `KAFKA_SSL_*`, `services/common/src/kafka.ts` |
| Topic mismatch | `LISTING_EVENTS_TOPIC`, `OCH_KAFKA_TOPIC_SUFFIX` |
| `daily_metrics` stale | Consumer logs, `listing-metrics-projection.ts`, `GET /api/analytics/daily-metrics` |
| Auth HTTP | `services/auth-service/src/server.ts`, gateway auth routes |
| Web session | `webapp/lib/auth-storage.ts`, Application → Local Storage |
| E2E base URL | `E2E_API_BASE`, `webapp/playwright.config.ts` |
| Contract drift | `./scripts/run-event-layer-verification.sh` |

---

## Cursor / implementer rules

- Prefer **one clear code path** for errors and logging; avoid duplicating JSON shapes in many handlers — extract helper.
- **Never** log passwords, refresh tokens, or MFA secrets.
- When touching **Kafka** consumers, verify **idempotency** and **topic suffix** alignment.
- After service changes, use the **rebuild matrix** above; do not ask reviewers to guess which image to rebuild.
- Keep **Franco** search work separate: use [`FRANCO_ISSUES_PLAYBOOK.md`](FRANCO_ISSUES_PLAYBOOK.md) for listings search/filter issues.

---

## Repo file index

| Topic | Paths |
|--------|--------|
| Kafka shared | `services/common/src/kafka.ts`, `kafka-wait.ts` |
| Listings events | `services/listings-service/src/listing-kafka.ts` |
| Analytics HTTP | `services/analytics-service/src/http-server.ts` |
| Analytics consumer | `services/analytics-service/src/consumers/listingEventsConsumer.ts` |
| Projection | `services/analytics-service/src/listing-metrics-projection.ts` |
| Auth HTTP | `services/auth-service/src/server.ts` |
| Auth gRPC | `services/auth-service/src/grpc-server.ts` |
| Gateway | `services/api-gateway/src/server.ts`, `proxy-limits.ts` |
| Webapp auth UX | `webapp/app/login/page.tsx`, `webapp/app/register/page.tsx`, `webapp/app/dashboard/page.tsx` |
| Webapp API | `webapp/lib/api.ts`, `webapp/lib/auth-storage.ts` |
| Playwright | `webapp/playwright.config.ts`, `webapp/e2e/**/*.spec.ts` |
| Event layer | `services/event-layer-verification/`, `scripts/run-event-layer-verification.sh` |
| Auth tests | `scripts/test-auth-service.sh` |
| Stack wiring | `scripts/test-housing-stack-wiring.sh` |

---

*If aligned with plain text: [`Github_issues copy.txt`](../Github_issues%20copy.txt) (owner may vary by branch).*
