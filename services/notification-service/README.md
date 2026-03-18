# notification-service

Consumes Kafka only. Email/push, rent reminders, price drop alerts. Stateless preferred.

**Architecture (v1):** Domain-isolated; cross-domain only via Kafka. See root [README.md](../../README.md) for full vision, service list, and non-negotiables.

**Build:** Use `services/common` (Kafka mTLS, Redis, gRPC, logger, metrics). Add package.json, tsconfig.json, Dockerfile (multi-stage; build common first), `/health`, `/metrics`. See docs/ARCHITECTURE.md and docs/CURSOR_SCAFFOLD_INSTRUCTIONS.md when present.
