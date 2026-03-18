# analytics-service

Consumes Kafka only. Event aggregation, platform metrics, revenue tracking, usage insights. Never in request path.

**Architecture (v1):** Domain-isolated; cross-domain only via Kafka. Never block request path. See root [README.md](../../README.md) for full vision, service list, and non-negotiables.

**Build:** Use `services/common` (Kafka mTLS, Redis, gRPC, logger, metrics). Add package.json, tsconfig.json, Dockerfile (multi-stage; build common first), `/health`, `/metrics`. See docs/ARCHITECTURE.md.

## Implementing this service (gRPC)

**Contract (source of truth):** [proto/analytics.proto](../../proto/analytics.proto) defines the RPCs and messages. It imports [proto/common.proto](../../proto/common.proto). Two services: `AnalyticsService` (metrics, recommendations) and `RecommendationAdminService` (internal control plane).

**If you're new to gRPC:** See [auth-service README](../auth-service/README.md#implementing-this-service-grpc) for the same 4 steps (proto = contract, generate code, implement handlers, register server).

**This service:** Implements `analytics.AnalyticsService` and optionally `analytics.RecommendationAdminService` from [proto/analytics.proto](../../proto/analytics.proto). Consumes Kafka for event ingestion; never in the critical request path. Implement [proto/health.proto](../../proto/health.proto) for probes.
