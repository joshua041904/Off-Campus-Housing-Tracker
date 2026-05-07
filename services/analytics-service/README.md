# analytics-service

**Ports:** HTTP **4017**, gRPC **50067** (Envoy `analytics_service` cluster uses **50067**).  
**DB:** `analytics` on **5447** (`POSTGRES_URL_ANALYTICS` / `ANALYTICS_DB_PORT`).

## What it does

- **Read-only** projections: `GetDailyMetrics`, `GetWatchlistInsights`, `GetRecommendations` (model metadata), `RecommendationAdmin` stubs.
- **Ollama**: `AnalyzeListingFeel` + HTTP `POST /insights/listing-feel` use **`OLLAMA_BASE_URL`** + **`OLLAMA_MODEL`** from env (see `src/ollama.ts`). In-cluster default in `infra/k8s/base/config/app-config.yaml` points at **`http://ollama.<ns>.svc.cluster.local:11434`** (Deployment `ollama` + init pull; Linux image, **not** Apple Metal). **Metal (Apple Silicon):** run **`ollama serve`** on the host (the native macOS build uses Metal automatically) and apply **`infra/k8s/overlays/dev/patches/analytics-service-ollama-host-metal.yaml`** so pods use **`http://host.docker.internal:11434`**. To skip Ollama, leave **`OLLAMA_BASE_URL`** empty (static fallback text only). Response includes **`quality_score`** (0–1 heuristic) and Prometheus **`analytics_listing_feel_quality_score`** / **`analytics_ollama_latency_ms`** may carry **`trace_id` exemplars** when OTel span is sampled (OpenMetrics `/metrics`).
- **Redis Lua locks** (`@common/utils`: `acquireLockWithToken` / `releaseLockWithToken`) + **`listing_feel_cache`** table reduce duplicate LLM work (thundering herd).

**Lab observability (single edge IP via Caddy):** `https://off-campus-housing.test/jaeger/` (Jaeger UI + Query API), `/grafana/`, `/prometheus/` — see `infra/k8s/caddy-h3-configmap.yaml` + `Caddyfile`. Trace scripts prefer `JAEGER_QUERY_BASE=https://off-campus-housing.test/jaeger` (`scripts/lib/jaeger-resolve-query-base.sh`). OTel collector stays ClusterIP-only.

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
