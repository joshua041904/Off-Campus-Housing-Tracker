# Messaging integration tests

Run with **Postgres (messaging + trust)** and **Redis** up (e.g. `docker compose` + `scripts/bootstrap-all-dbs.sh`). This folder **does not** open a Kafka client: test **A** asserts the **transactional outbox** row (`messaging.outbox_events`) with **`published = false`** after commit — the same pattern the background publisher uses before producing to Kafka.

## Layers

- **Unit** — `pnpm test` (handlers, rate limiter, etc.).
- **Integration** — `pnpm test:integration` → `tests/integration/*.integration.test.ts`: DB outbox insert + Redis rate limit + Trust DB spam row. **No plaintext/cluster Kafka required** for this suite.
- **E2E / load** — see repo scripts and `docs/OUTBOX_PUBLISHER_IMPLEMENTATION.md` for publisher → Kafka.

## Running

```bash
pnpm --filter messaging-service run test:integration
```

Tests expect messaging DB on **`MESSAGING_DB_PORT`** (default **5444**), Trust on **5446**, Redis **`REDIS_URL`** (defaults set in `tests/setup/env.ts`).
