# Local dev runbook — full lifecycle

Deterministic, repeatable dev lifecycle: external infra → bootstrap DBs → k3s → deploy → smoke → k6 → chaos.

## External infra (outside k3s)

- **Postgres** — ports 5441–5447 (auth, listings, bookings, messaging, notification, trust, analytics)
- **Kafka** — strict TLS (e.g. host 29094 → 9093)
- **Redis** — e.g. 6380
- **MinIO** — for media (optional for messaging-only)

Start with:

```bash
./scripts/bring-up-external-infra.sh
```

Or docker-compose subset (e.g. postgres-auth, postgres-messaging, redis, kafka).

## DB bootstrap (deterministic)

**Option A — SQL migrations (preferred for team)**

```bash
PGPASSWORD=postgres ./scripts/bootstrap-all-dbs.sh
```

Order: auth → listings → bookings → messaging → notification → trust → analytics. Uses `infra/db/*.sql`. Single DB: `BOOTSTRAP_ONLY=messaging ./scripts/bootstrap-all-dbs.sh`.

**Drop and recreate (identical state every run)**

```bash
DROP_IF_EXISTS=true PGPASSWORD=postgres ./scripts/bootstrap-all-dbs.sh
```

Then verify:

```bash
PGPASSWORD=postgres ./scripts/verify-bootstrap.sh
```

Checks: each DB reachable, required tables (outbox, processed_events where applicable), messaging.messages + outbox_events + conversations.

**Option B — Restore auth from dump**

If you have `backups/5437-auth.dump` (or `.gz` / `.zip`):

```bash
PGPASSWORD=postgres ./scripts/restore-auth-db.sh
```

Restores into port **5441** (auth). Then run bootstrap for outbox: `BOOTSTRAP_ONLY=auth ./scripts/bootstrap-all-dbs.sh` or rely on auth outbox from bootstrap.

## ConfigMap (canonical)

- **DATABASE_HOST** — `host.docker.internal` or `host.lima.internal` (Colima). No hostAliases; services build URLs from `DATABASE_HOST` + `*_DB_PORT`.
- Ports: **AUTH_DB_PORT=5441**, LISTINGS_DB_PORT=5442, … ANALYTICS_DB_PORT=5447.

Override in overlay or patch for your environment.

## k3s + deploy

```bash
./scripts/deploy-dev.sh
```

Steps: context check → namespaces → secrets (must exist) → ConfigMap → kustomize apply → Caddy/Envoy rollout → wait readiness → smoke test → optional k6.

- **SKIP_SMOKE=1** — skip smoke test.
- **SKIP_K6=1** — skip k6 (default).

## Smoke test

```bash
./scripts/smoke-test-dev.sh
```

Checks: Caddy `/_caddy/healthz`, gateway `/healthz`, `/api/messaging/healthz`. Uses `certs/dev-root.pem` and LB IP or NodePort.

## Messaging tests

| Layer | Command | Requires |
|-------|--------|----------|
| Unit | `pnpm --filter messaging-service run test` | — |
| Integration | `pnpm --filter messaging-service run test:integration` | Postgres (messaging), Redis, Kafka up |
| E2E | k6 messaging-flow after deploy | Cluster + auth bootstrap |
| Chaos | Kill messaging pod; verify outbox retry / dedupe | Event-layer-verification patterns |

## k6 messaging and media

- **E2E (auth + messaging):** `k6 run scripts/load/k6-messaging-e2e.js` — register, login, create conversation, send, get conversation. Thresholds: P95 &lt; 200ms, P99 &lt; 350ms, max &lt; 800ms.
- **Health / load:** `K6_PHASES=messaging ./scripts/load/run-k6-phases.sh` (uses `scripts/load/k6-messaging.js`).
- **Flow (50 msg / 60s):** `k6 run scripts/load/k6-messaging-flow.js` — P95/P99/max thresholds; expect some rate limited, no 500s.
- **Limit finder:** `k6 run scripts/load/k6-messaging-limit-finder.js` — ramping-arrival-rate until P99 &gt; 500ms or error rate &gt; 5%.
- **Spam:** `k6 run scripts/load/k6-spam-test.js` — same message to 30 recipients; expect Trust flag, permission denied.
- **Media upload:** `k6 run scripts/load/k6-media-upload.js` — login, create-upload-url, PUT to presigned URL, complete-upload (P95 &lt; 400ms, max &lt; 1500ms).

## Exactly-once semantics (clarified)

- **Not** Kafka “exactly once producer.”
- **Yes:** no lost events, at-least-once delivery, idempotent consumers, deterministic retries. No Kafka transactions.

## Clean dev lifecycle (summary)

1. Start external infra (Postgres, Kafka, Redis, MinIO).
2. Run **bootstrap-all-dbs.sh** (or **restore-auth-db.sh** then bootstrap).
3. Start k3s (Colima / k3d).
4. **deploy-dev.sh**.
5. **smoke-test-dev.sh**.
6. k6 load (messaging phase or full).
7. Chaos: kill messaging pod; verify no message loss, outbox retry, consumer dedupe.
8. Check Grafana / metrics.

## FULL DEV TEST CYCLE (verification discipline)

1. `docker compose up -d` (or bring-up-external-infra.sh)
2. `DROP_IF_EXISTS=true PGPASSWORD=postgres ./scripts/bootstrap-all-dbs.sh`
3. `PGPASSWORD=postgres ./scripts/verify-bootstrap.sh`
4. k3s up
5. `./scripts/deploy-dev.sh`
6. `./scripts/smoke-test-dev.sh`
7. `k6 run scripts/load/k6-messaging-limit-finder.js`
8. `k6 run scripts/load/k6-messaging-e2e.js`
9. `k6 run scripts/load/k6-spam-test.js` (optional)
10. `PGPASSWORD=postgres ./scripts/verify-messaging-integrity.sh`
11. Chaos: kill messaging pod; re-run verify-messaging-integrity.sh

If all green → system stable.

## Pre-k3s validation matrix

Before moving fully into k3s, all must pass:

| Test | Must pass |
|------|-----------|
| DB bootstrap idempotent | ✅ |
| Auth restore works | ✅ |
| verify-bootstrap.sh | ✅ |
| Messaging send under load | P95 &lt; 200ms |
| P100 (max) | &lt; 800ms |
| Spam detection triggers | ✅ |
| Outbox retry after kill | ✅ |
| Kafka down retry works | ✅ |
| Health reports correct | ✅ |
| No duplicate message rows | ✅ |
| verify-messaging-integrity.sh | ✅ |

## Files reference

| Item | Path |
|------|------|
| Bootstrap all DBs | `scripts/bootstrap-all-dbs.sh` |
| Drop and recreate | `DROP_IF_EXISTS=true ./scripts/bootstrap-all-dbs.sh` |
| Verify bootstrap | `scripts/verify-bootstrap.sh` |
| Restore auth dump | `scripts/restore-auth-db.sh` |
| Deploy dev | `scripts/deploy-dev.sh` |
| Smoke test | `scripts/smoke-test-dev.sh` |
| Verify messaging integrity | `scripts/verify-messaging-integrity.sh` |
| ConfigMap | `infra/k8s/base/config/app-config.yaml` |
| Messaging integration tests | `services/messaging-service/tests/integration/` |
| k6 E2E | `scripts/load/k6-messaging-e2e.js` |
| k6 limit finder | `scripts/load/k6-messaging-limit-finder.js` |
| k6 media upload | `scripts/load/k6-media-upload.js` |
| k6 messaging | `scripts/load/k6-messaging.js`, `k6-messaging-flow.js`, `k6-spam-test.js` |
