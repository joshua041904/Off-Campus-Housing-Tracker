# listings-service

Owns: listings, geolocation, pricing, availability, search index, filtering, image metadata. DB: listings. No booking logic. Emit Kafka on listing changes.

**Architecture (v1):** Domain-isolated; no cross-service DB access. Cross-domain only via Kafka. See root [README.md](../../README.md) for full vision, service list, and non-negotiables.

**Build:** Use `services/common` (Kafka mTLS, Redis, gRPC, logger, metrics). Add package.json, tsconfig.json, Dockerfile (multi-stage; build common first), `/health`, `/metrics`, Prisma schema. See docs/ARCHITECTURE.md.

## Implementing this service (gRPC)

**Contract (source of truth):** [proto/listings.proto](../../proto/listings.proto) defines the RPCs and messages. It imports [proto/common.proto](../../proto/common.proto) for pagination and shared types.

**If you're new to gRPC:** Read **[docs/GRPC_ONBOARDING.md](../../docs/GRPC_ONBOARDING.md)** (workflow, status codes, testing bar). For auth-specific patterns, see [auth-service README](../auth-service/README.md#implementing-this-service-grpc) (proto = contract, implement handlers, register server).

**This service:** Implements `listings.ListingsService` from [proto/listings.proto](../../proto/listings.proto) (`CreateListing`, `GetListing`, `SearchListings`). Implement [proto/health.proto](../../proto/health.proto) for probes.

# Running & Testing (CreateListing)

Prerequisites

- Docker installed and running

- pnpm install completed at repo root

- grpcurl installed

## Configuration

- **`POSTGRES_URL_LISTINGS`** — full URL (used in k8s from `app-config`).
- **`LISTINGS_DB_PORT`** — default **5442** when building URL from `DB_HOST` + `DB_USER` / `DB_PASSWORD` / `DB_NAME` (generic **`DB_PORT` is ignored** so another service’s port cannot override listings).

Kafka listing topic must match `scripts/create-kafka-event-topics.sh`: **`${ENV_PREFIX}.listing.events`** (set `LISTING_EVENTS_TOPIC` / `ENV_PREFIX` in deploy).

### 1. Start Postgres (listings DB)

```bash
docker rm -f listings-postgres 2>/dev/null || true

docker run --name listings-postgres \
 -e POSTGRES_PASSWORD=postgres \
 -e POSTGRES_DB=listings \
 -p 5442:5432 \
 -d postgres:16-alpine
```

### 2. Apply database schema

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5442 -U postgres -d listings -f infra/db/01-listings-schema-and-tuning.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5442 -U postgres -d listings -f infra/db/02-listings-pgbench-trigram-knn.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5442 -U postgres -d listings -f infra/db/03-listings-outbox.sql
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5442 -U postgres -d listings -f infra/db/04-listings-processed-events.sql
```

### 3. Unit tests (no DB required)

From repo root:

```bash
pnpm --filter listings-service test
```

Covers `validation.ts`, `search-listings-query.ts`, and HTTP app construction (`createListingsHttpApp`). CI runs this via the `listings-service` matrix job.

### 4. Start the listings-service

```bash
pnpm --filter listings-service dev
```

Default ports: **HTTP 4012**, **gRPC 50062** (override with `HTTP_PORT` / `GRPC_PORT`).

You should see logs for both HTTP and gRPC listeners.

### 5. Test CreateListing (gRPC)

```bash
grpcurl -plaintext \
 -import-path ./proto \
 -proto listings.proto \
 -d '{
"user_id": "11111111-1111-4111-8111-111111111111",
"title": "Test Apartment",
"description": "Nice place near campus",
"price_cents": 120000,
"amenities": ["parking", "laundry"],
"smoke_free": true,
"pet_friendly": false,
"furnished": true,
"effective_from": "2026-04-01",
"effective_until": "2026-08-31"
}' \
 localhost:50062 listings.ListingsService/CreateListing
```

Expected Response:
{
"listingId": "ff66a6ec-39a1-4ab4-b773-a0685a492264",
"userId": "11111111-1111-1111-1111-111111111111",
"title": "Test Apartment",
"description": "Nice place near campus",
"priceCents": 120000,
"amenities": [
"parking",
"laundry"
],
"smokeFree": true,
"furnished": true,
"status": "active",
"createdAt": "2026-03-20T15:56:19.080Z"
}

### 6. Verify insertion

```bash
PGPASSWORD=postgres psql -h 127.0.0.1 -p 5442 -U postgres -d listings
```

```SQL
SELECT id, user_id, title, price_cents, status, created_at
FROM listings.listings
ORDER BY created_at DESC
LIMIT 5;
```
**Before opening a PR:** Use **[docs/PR_REVIEW_GRPC_HANDLER_PASTE.example.txt](../../docs/PR_REVIEW_GRPC_HANDLER_PASTE.example.txt)** (copy blocks into GitHub). Optional gitignored local file: `docs/PR_REVIEW_GRPC_HANDLER_PASTE.txt`.
