# listings-service

Owns: listings, geolocation, pricing, availability, search index, filtering, image metadata. DB: listings. No booking logic. Emit Kafka on listing changes.

**Architecture (v1):** Domain-isolated; no cross-service DB access. Cross-domain only via Kafka. See root [README.md](../../README.md) for full vision, service list, and non-negotiables.

**Build:** Use `services/common` (Kafka mTLS, Redis, gRPC, logger, metrics). Add package.json, tsconfig.json, Dockerfile (multi-stage; build common first), `/health`, `/metrics`, Prisma schema. See docs/ARCHITECTURE.md.

## Implementing this service (gRPC)

**Contract (source of truth):** [proto/listings.proto](../../proto/listings.proto) defines the RPCs and messages. It imports [proto/common.proto](../../proto/common.proto) for pagination and shared types.

**If you're new to gRPC:** See [auth-service README](../auth-service/README.md#implementing-this-service-grpc) for the same 4 steps (proto = contract, generate code, implement handlers, register server).

**This service:** Implements `listings.ListingsService` from [proto/listings.proto](../../proto/listings.proto) (`CreateListing`, `GetListing`, `SearchListings`). Implement [proto/health.proto](../../proto/health.proto) for probes.
