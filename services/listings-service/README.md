# listings-service

Owns: listings, geolocation, pricing, availability, search index, filtering, image metadata. DB: listings. No booking logic. Emit Kafka on listing changes.

**Architecture (v1):** Domain-isolated; no cross-service DB access. Cross-domain only via Kafka. See root [README.md](../../README.md) for full vision, service list, and non-negotiables.

**Build:** Use `services/common` (Kafka mTLS, Redis, gRPC, logger, metrics). Add package.json, tsconfig.json, Dockerfile (multi-stage; build common first), `/health`, `/metrics`, Prisma schema. See docs/ARCHITECTURE.md and docs/CURSOR_SCAFFOLD_INSTRUCTIONS.md when present.
