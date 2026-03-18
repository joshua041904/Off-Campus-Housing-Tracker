# analytics-service

Consumes Kafka only. Event aggregation, platform metrics, revenue tracking, usage insights. Never in request path.

**Architecture (v1):** Domain-isolated; cross-domain only via Kafka. Never block request path. See root [README.md](../../README.md) for full vision, service list, and non-negotiables.

**Build:** Use `services/common` (Kafka mTLS, Redis, gRPC, logger, metrics). Add package.json, tsconfig.json, Dockerfile (multi-stage; build common first), `/health`, `/metrics`. See docs/ARCHITECTURE.md and docs/CURSOR_SCAFFOLD_INSTRUCTIONS.md when present.
