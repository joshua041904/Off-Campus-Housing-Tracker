# Messaging integration tests

Run with **Postgres (messaging), Redis, Kafka** up (e.g. `docker compose -f docker-compose.local.yml up -d` + init-db).

## Layers

- **A. Unit** — `pnpm test` (handlers, rate limiter, outbox insert). No cluster.
- **B. Integration** — `pnpm test:integration` (this folder). Flow: register → login → create conversation → send message; assert DB row, outbox row, Kafka event; Trust not triggered.
- **C. E2E** — Cluster up, k6: register, login, send 20 messages, rate limit check, spam threshold, analytics updated.
- **D. Chaos** — Kill messaging pod mid-send; assert no message loss, outbox retry, consumer dedupe.

## Running

```bash
# From repo root, with external infra up:
pnpm --filter messaging-service run test:integration
```

Tests expect:
- `DATABASE_HOST`, `MESSAGING_DB_PORT` (or `POSTGRES_URL_MESSAGING`), `REDIS_URL`, Kafka (TLS) reachable.
- Auth gRPC or REST for register/login (or mock JWT for send-only tests).
