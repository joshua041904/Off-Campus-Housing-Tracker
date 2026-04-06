# Vitest expectations per service (endpoints, Kafka, outbox, cross-service)

This is the **verification contract** for the monorepo: what each layer must prove, and what is **incremental backlog** (not done in one PR).

## Non‑negotiables

### Kafka in Vitest integration (listings, booking, repo `test:system`)

- **Cluster-only:** `applyVitestClusterKafkaBrokerEnv` from `@common/utils/kafka-vitest-cluster`.
- **≥ 3 broker seeds** on **TLS** (typically MetalLB `kafka-0/1/2-external` `:9094` + `certs/kafka-ssl` or CI TLS dir).
- **No plaintext** `KAFKA_BROKER` for these suites (helpers throw if SSL disabled with multi-seed).
- **Env:** `OCH_INTEGRATION_KAFKA_FROM_K8S_LB=1` (or explicit `KAFKA_BROKER` with three seeds + PEM paths). See each service’s `test:integration` script and `vitest.integration.config.*`.
- **Root gate:** `pnpm run test:integration:all` runs `node scripts/assert-kafka-integration-cluster.mjs` **after** trust and **before** listings/booking (same invariants as `@common/utils/kafka-vitest-cluster`: ≥3 unique seeds, TLS PEM files on disk, no localhost / `:29092`, no `CI_KAFKA_PLAINTEXT`, topic metadata replica count ≥3 is checked inside `ensureVitestClusterKafkaTopic`). The script loads **`services/common/dist/kafka-vitest-cluster.js`** — run `pnpm -C services/common run build` first if `dist` is missing. Escape hatch (e.g. machines without a cluster): `OCH_SKIP_KAFKA_INTEGRATION_ASSERT=1` — not a substitute for real integration signal.

Services that **do not** need Kafka in Vitest: analytics HTTP integration (DB-only surface), trust (DB-only), media upload integration (mock S3), messaging flow integration (DB+Redis; no Kafka client in that file).

### Transactional outbox

Only assert outbox **where application code writes it**. Matrix: [outbox-coverage-by-service.md](./outbox-coverage-by-service.md).

### Cross-service behavior

| Layer | Role |
|--------|------|
| **Unit** (`pnpm run test` per package) | Pure logic, mocks OK. |
| **Service integration** (`test:integration` / `test:integration:all`) | One service, real DB (and Kafka where that service’s config says so). |
| **System contracts** (`pnpm run test:system`) | Observable multi-hop (e.g. listing event → analytics DB). **No** cross-service HTTP through the gateway here — see [system-test-rules.md](./system-test-rules.md). |
| **Event-layer** (`services/event-layer-verification`) | Outbox publisher **semantics** (in-memory). |
| **Shell / preflight** | Infra, TLS, MetalLB, k6 — **not** duplicated inside Vitest. |

Do not require “every service integration test calls every other service’s HTTP API.” Use **system contracts** + **ordered** `test:integration:all` for staged confidence.

---

## Per-service matrix (honest status)

| Service | `pnpm run test` | `test:integration` | HTTP/gRPC route coverage in integration | Kafka in integration | Outbox tested |
|---------|-----------------|-------------------|----------------------------------------|------------------------|---------------|
| **analytics-service** | yes | yes (HTTP+DB) | **Strong** — health, metrics, daily-metrics, ingest gate, insights | no | n/a (consumes events; not outbox writer here) |
| **booking-service** | yes | yes | **Strong** — describes full HTTP surface in suite | **yes** (3-seed TLS) | n/a (no outbox write in app code today) |
| **listings-service** | yes | yes (HTTP + gRPC) | **Good** — create + Kafka offset, search, get by id, invalid id; **health/metrics/`GET /` added in integration** | **yes** (3-seed TLS) | n/a (direct Kafka publish) |
| **trust-service** | yes | yes | **Partial** — several trust routes + DB asserts; not every route | no | n/a |
| **messaging-service** | yes | yes (under `tests/integration`) | **Narrow** — outbox pattern + rate limit + spam DB; **not** every `messages.ts` / `forum.ts` route | no | **yes** (txn + `published=false`) |
| **media-service** | yes | yes | **Narrow** — upload path + **outbox row** after `completeUpload` | no | **yes** |
| **auth-service** | yes | no dedicated HTTP integration in table | smoke + **outbox publisher unit** | no | **yes** (publisher) |
| **api-gateway** | smoke | — | smoke only — **backlog: route matrix vs gateway** | no | n/a |
| **notification-service** | smoke | — | smoke only — **backlog** | no | n/a |
| **cron-jobs** | smoke | — | smoke — **backlog** if HTTP/cron surface grows | no | n/a |
| **event-layer-verification** | yes | — | N/A (library tests) | no | semantics only |
| **@common/utils** | yes | — | N/A | n/a | n/a |

---

## Orchestration commands

```bash
# All service integrations in dependency-friendly order (Postgres-first, Kafka-heavy last)
pnpm run test:integration:all

# Repo-root system contracts (Kafka + analytics DB)
pnpm run test:system

# Explicit order: integration:all → system → unit batch (no duplicated suites)
pnpm run test:vitest-stack
# or: make test-vitest-stack   # runs pnpm -C services/common build first

# Fail-fast units, then integration:all, then system (full stack; same invariants)
pnpm run test:smoke
```

Preflight: `PREFLIGHT_RUN_REPO_VITEST_STACK` defaults to **on** (step 7a0c: `services/common` build + `pnpm run test:vitest-stack`). Set `PREFLIGHT_RUN_REPO_VITEST_STACK=0` to skip. `PREFLIGHT_RUN_SYSTEM_CONTRACTS=1` runs `test:system` only when the stack step is off — see `scripts/run-preflight-scale-and-all-suites.sh`.

---

## Backlog (incremental — do not “big bang”)

1. **api-gateway** — map `routes` / proxy table → Vitest supertest per upstream health or contract stub.  
2. **notification-service** — integration with test doubles or real channel mocks when delivery paths stabilize.  
3. **messaging-service** — add **targeted** HTTP integration tests for highest-risk routes (auth, validation, 4xx) without duplicating Playwright.  
4. **auth-service** — optional HTTP integration for register/login **against test DB** (heavy; often E2E-covered).  
5. **trust-service** — fill any HTTP routes not yet hit in `trust-http.integration.test.ts`.  
6. **Cross-service** — new **system** tests only when a **stable observable** exists (e.g. booking → analytics when consumer exists).

---

## Related docs

- [integration-test-tiers.md](./integration-test-tiers.md)  
- [service-coverage-checklist.md](./service-coverage-checklist.md)  
- [outbox-coverage-by-service.md](./outbox-coverage-by-service.md)  
- [system-test-rules.md](./system-test-rules.md)  
