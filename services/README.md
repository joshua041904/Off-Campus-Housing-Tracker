# Services (substrate + housing-platform 7 domain services)

**Architecture (v1):** See root [README.md](../README.md) for vision, 7 services, communication rules, and non-negotiables. Event-driven; no cross-service DB access; cross-domain only via Kafka.

**gRPC contracts:** All service APIs are defined in the repo root [proto/](../proto/) directory. Each service README has an **Implementing this service (gRPC)** section that points to the relevant `.proto` file(s) and steps for first-time gRPC implementers. The API gateway ([api-gateway/README.md](api-gateway/README.md)) lists which proto backs each backend.

## Substrate (shared)

- **common** — Kafka client (mTLS), Redis, Logger (Pino), Prometheus metrics, gRPC helpers, proto loader. No business logic. Use in every service.
- **api-gateway** — Auth middleware, rate limiting, gRPC proxy to the 7 backends. No business logic. See [api-gateway/README.md](api-gateway/README.md) and [proto/](../proto/) for supported services and contracts.
- **cron-jobs** — Scheduled jobs (rent reminders, cleanup). Adapt for housing.
- **webapp/** (repo root) — Next.js reference. Adapt for housing UI.

## Ported

- **auth-service** — Users, roles (tenant, landlord, admin), JWT, MFA/passkeys. DB: auth. Restore from `backups/5437-auth.dump` (see backups/README.txt).

## Housing 7 domain services (skeletons → implement per ARCHITECTURE.md)

| # | Service | DB | Role |
|---|---------|-----|------|
| 1 | auth-service | auth | ✅ Ported |
| 2 | listings-service | listings | Listings, geo, pricing, search, filtering (skeleton) |
| 3 | booking-service | bookings | Reservation lifecycle, Kafka: booking_created/confirmed/cancelled (skeleton) |
| 4 | messaging-service | messaging | Conversations, messages (skeleton) |
| 5 | notification-service | — | Kafka consumer only; stateless (skeleton) |
| 6 | trust-service | trust | Reviews, ratings, moderation, listing_flagged (skeleton) |
| 7 | analytics-service | — | Kafka consumer only; never in request path (skeleton) |

Event-driven: cross-domain only via Kafka. No cross-service DB access. Each service: own Prisma, /health, /metrics, Dockerfile (multi-stage, build common first). See docs/ARCHITECTURE.md.
