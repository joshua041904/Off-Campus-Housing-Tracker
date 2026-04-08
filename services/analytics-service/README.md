# analytics-service

**Ports:** HTTP **4017**, gRPC **50067** (Envoy `analytics_service` cluster uses **50067**).  
**DB:** `analytics` on **5447** (`POSTGRES_URL_ANALYTICS` / `ANALYTICS_DB_PORT`).

## What it does

- **Read-only** projections: `GetDailyMetrics`, `GetWatchlistInsights`, `GetRecommendations` (model metadata), `RecommendationAdmin` stubs.
- **Ollama** (optional): `AnalyzeListingFeel` + HTTP `POST /insights/listing-feel` — set **`OLLAMA_BASE_URL`** (e.g. `http://host.docker.internal:11434`) and **`OLLAMA_MODEL`**.
- **Redis Lua locks** (`@common/utils`: `acquireLockWithToken` / `releaseLockWithToken`) + **`listing_feel_cache`** table reduce duplicate LLM work (thundering herd).

## Schema

Apply in order:

1. `infra/db/01-analytics-schema.sql` … `03-analytics-recommendation.sql`
2. `infra/db/04-analytics-watchlist-engagement.sql` (watchlist + engagement + feel cache)

## Kafka

Topic **`${ENV_PREFIX}.analytics.events`** — see `proto/events/analytics.proto` + `scripts/create-kafka-event-topics.sh`.

## Build

```bash
pnpm --filter @common/utils build
pnpm --filter analytics-service build
docker build -t analytics-service:dev -f services/analytics-service/Dockerfile .
```

## Testing

- **Unit:** `pnpm run test` (excludes `*.integration.test.ts`).
- **HTTP integration (DB tier):** `pnpm run test:integration` — `createAnalyticsHttpApp()` + Postgres **5447**; no Kafka consumer startup. See repo **`docs/integration-test-tiers.md`** and root **`pnpm run test:integration:all`**.
