# trust-service

Owns: reviews, ratings aggregation, report abuse, moderation, listing flag state. DB: trust. Emit: user_suspended, listing_flagged.

**Architecture (v1):** Domain-isolated; no cross-service DB access. Cross-domain only via Kafka. See root [README.md](../../README.md) for full vision, service list, and non-negotiables.

**Build:** Use `services/common` (Kafka mTLS, Redis, gRPC, logger, metrics). Add package.json, tsconfig.json, Dockerfile (multi-stage; build common first), `/health`, `/metrics`, Prisma schema. See docs/ARCHITECTURE.md.

## Implementing this service (gRPC)

**Contract (source of truth):** [proto/trust.proto](../../proto/trust.proto) defines the RPCs and messages.

**If you're new to gRPC:** See [auth-service README](../auth-service/README.md#implementing-this-service-grpc) for the same 4 steps (proto = contract, generate code, implement handlers, register server).

**This service:** Implements `trust.TrustService` from [proto/trust.proto](../../proto/trust.proto) (`FlagListing`, `SubmitReview`, `GetReputation`). Emit Kafka on flag/review/reputation changes. Implement [proto/health.proto](../../proto/health.proto) for probes.
