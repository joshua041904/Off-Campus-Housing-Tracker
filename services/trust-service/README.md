# trust-service

Owns: reviews, ratings aggregation, report abuse, moderation, listing flag state. DB: trust. Emit: user_suspended, listing_flagged.

**Architecture (v1):** Domain-isolated; no cross-service DB access. Cross-domain only via Kafka. See root [README.md](../../README.md) for full vision, service list, and non-negotiables.

**Build:** Use `services/common` (Kafka mTLS, Redis, gRPC, logger, metrics). Add package.json, tsconfig.json, Dockerfile (multi-stage; build common first), `/health`, `/metrics`, Prisma schema. See docs/ARCHITECTURE.md.

## Implementing this service (gRPC)

**Contract (source of truth):** [proto/trust.proto](../../proto/trust.proto) defines the RPCs and messages.

**If you're new to gRPC:** See [auth-service README](../auth-service/README.md#implementing-this-service-grpc) for the same 4 steps (proto = contract, generate code, implement handlers, register server).

**This service:** Implements `trust.TrustService` from [proto/trust.proto](../../proto/trust.proto) (`FlagListing`, `SubmitReview`, `GetReputation`). Emit Kafka on flag/review/reputation changes. Implement [proto/health.proto](../../proto/health.proto) for probes.

## Configuration

- **`POSTGRES_URL_TRUST`** — full URL (k8s: `app-config` → port **5446**, database `trust`).
- **`TRUST_DB_PORT`** — default **5446** when composing URL from `DB_HOST` (**`DB_PORT` is ignored**).

Apply schema: `PGPASSWORD=postgres ./scripts/ensure-trust-schema.sh` or `psql -h 127.0.0.1 -p 5446 -U postgres -d trust -f infra/db/01-trust-schema.sql`.

## Flag / report-abuse — where to look

| Area | Files / notes |
|------|----------------|
| **HTTP report abuse** | [`src/http-server.ts`](src/http-server.ts) — `POST /report-abuse` (validation, `INSERT`, generic `500` on catch). |
| **gRPC report / flag** | [`src/grpc-server.ts`](src/grpc-server.ts) — `ReportAbuse`, `FlagListing` (same `INSERT` idea; errors → `INTERNAL` + `"failed"`). |
| **Schema intent** | [`infra/db/01-trust-schema.sql`](../../infra/db/01-trust-schema.sql) — comment: *one listing can be flagged multiple times*; **no** `UNIQUE` on `(listing_id, reporter_id)` etc., so duplicate reports = **multiple rows** today (not corrupted state, but may not match idempotent product behavior). |
| **Peer review pattern to copy** | Same [`src/http-server.ts`](src/http-server.ts): `peer-review` maps `23505` / `"unique"` → **409** `{ "error": "duplicate review" }`. Flag paths do not yet (needs product rule: duplicate = new row vs **409** vs return existing `flag_id`). |
| **Invalid `target_id`** | Bad UUIDs often hit Postgres and surface as **500** `"internal"` unless you validate UUID (or catch `22P02` / FK) and return **400** with a stable error shape. |
| **Webapp trust UI** | [`webapp/app/trust/page.tsx`](../../webapp/app/trust/page.tsx) (forms + `reportAbuse`), [`webapp/lib/api.ts`](../../webapp/lib/api.ts) (`reportAbuse` → `/api/trust/report-abuse`). For *only refresh UI when response fields change*, key off returned `flag_id` / `status` (and/or a stable error type from the API) instead of always resetting generic success text. |
