# Services, features, and endpoints

Single reference for **deployable workloads** under `services/*`, their **roles**, **HTTP** paths (as implemented on each service), **gRPC** APIs from `proto/*.proto`, and how **`api-gateway`** exposes them externally. Default ports follow **README / ENGINEERING** (override with env in cluster).

**Path convention:** Clients typically call **`https://<edge>/api/<domain>/...`**. The gateway strips the `/api/<domain>` prefix when proxying to the upstream service (e.g. `/api/booking/create` → booking-service **`POST /create`**).

---

## Quick reference (ports)

| Service | HTTP (typical) | gRPC (typical) | Primary data store |
|--------|----------------|------------------|--------------------|
| api-gateway | 4020 | — | Redis (JWT revocation, limits) |
| auth-service | 4011 | 50061 | Postgres `auth`, Redis |
| listings-service | 4012 | 50062 | Postgres `listings`, Kafka |
| booking-service | 4013 | 50063 | Postgres `bookings` |
| messaging-service | 4014 | 50064 | Postgres `forum` / `messages`, Redis, Kafka |
| notification-service | 4015 | 50065 | Postgres (notifications schema) |
| trust-service | 4016 | 50066 | Postgres (trust schema) |
| analytics-service | 4017 | 50067 | Postgres / Ollama (insights) |
| media-service | 4018 | 50068 | Postgres + object storage hooks |
| cron-jobs | — | — | Calls notification internal URL |
| **@common/utils** | — | — | Shared library (not a pod) |
| **event-layer-verification** | — | — | Vitest-only Kafka contract tests |

---

## api-gateway (`services/api-gateway`)

**Role:** Edge-facing HTTP API: **rate limiting**, **JWT verification** (and optional Redis revocation), **identity headers** (`x-user-id`, etc.) for upstreams, **reverse proxy** to housing HTTP services, **gRPC** for auth register/login/validate/refresh, **trace id** propagation, **coalesced** handling for hot read paths (e.g. analytics daily metrics).

**Direct endpoints (on gateway):**

| Method | Path | Notes |
|--------|------|--------|
| GET | `/healthz`, `/api/healthz` | Liveness |
| GET | `/readyz`, `/api/readyz` | Readiness (auth gRPC health) |
| GET | `/metrics` | Prometheus |
| GET | `/whoami` | Pod hostname |
| POST | `/auth/register`, `/api/auth/register` | gRPC → auth Register |
| POST | `/auth/login`, `/api/auth/login` | gRPC → auth Authenticate |
| POST | `/auth/validate`, `/api/auth/validate` | gRPC → auth ValidateToken |
| POST | `/auth/refresh`, `/api/auth/refresh` | gRPC → auth RefreshToken |
| GET | `/auth/healthz`, `/auth/metrics` | Proxy → auth HTTP |
| GET | `/*/healthz` for listings, booking, messaging, trust, analytics, media, notification | Per-service health proxies |

**Proxied prefixes (after JWT for protected routes; see `OPEN_ROUTES` in `server.ts` for public exceptions):**

- `/auth`, `/api/auth` → auth HTTP (4011)
- `/listings`, `/api/listings` → listings (4012)
- `/booking`, `/api/booking` → booking (4013)
- `/messaging`, `/api/messaging` → messaging (4014)
- `/trust`, `/api/trust` → trust (4016)
- `/analytics`, `/api/analytics` → analytics (4017)
- `/media`, `/api/media` → media HTTP (4018), long proxy timeout
- `/notification`, `/api/notification` → notification (4015)

---

## auth-service (`services/auth-service`)

**Role:** Users, sessions, JWT issuance, Redis-backed caching/revocation, **Google OAuth**, **passkeys**, **email/phone verification**, static **privacy/terms**, Prometheus metrics. **gRPC** mirrors core auth for the gateway.

**HTTP (service root; gateway uses `/api/auth/...` + strip):**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/healthz` | Health |
| GET | `/metrics` | Prometheus |
| POST | `/register` | Register (+ optional email verification flow) |
| POST | `/login` | Login (MFA fields supported in payload where applicable) |
| POST | `/logout` | Logout / revocation |
| POST | `/validate` | Validate JWT |
| POST | `/refresh` | Refresh token |
| DELETE | `/account` | Delete account |
| GET | `/me` | Current user |
| GET | `/privacy`, `/terms` | Static HTML policies |
| * | `/auth/google`, `/auth/google/callback` | Google OAuth (under `setupOAuthRoutes` mounted at `/auth`) |
| * | `/passkeys/*` | Passkey register/auth/list/delete |
| * | `/verify/*` | Email/phone send + verify codes |

**gRPC `AuthService` (`proto/auth.proto`):** `Authenticate`, `Register`, `ValidateToken`, `RefreshToken`, `HealthCheck` (uses `health.proto` types).

**Note:** `routes/mfa.ts` defines MFA HTTP handlers (`/setup`, `/verify`, `/disable`, `/verify-login`) but **`server.ts` does not `app.use` them** — MFA is partly reflected in **gRPC/Authenticate** and Prisma fields; wire the router if you want standalone MFA REST.

---

## listings-service (`services/listings-service`)

**Role:** Listing catalog, search, public browse, authenticated create, Kafka listing events, optional **analytics sync** (env-driven).

**HTTP (`http-server.ts`):**

| Method | Path | Auth |
|--------|------|------|
| GET | `/healthz`, `/health` | No |
| GET | `/metrics` | No |
| GET | `/`, `/search` | Public search / index |
| GET | `/listings/:id` | Public detail |
| POST | `/create` | Requires `x-user-id` (gateway) |

**gRPC `ListingsService` (`proto/listings.proto`):** `CreateListing`, `GetListing`, `SearchListings`.

---

## booking-service (`services/booking-service`)

**Role:** Booking lifecycle, **saved search history**, **watchlist**.

**HTTP:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/healthz`, `/health` | Health |
| GET | `/metrics` | Prometheus |
| POST | `/create` | Create booking |
| POST | `/confirm` | Confirm |
| POST | `/cancel` | Cancel |
| GET | `/:bookingId` | Get by id |
| POST | `/search-history` | Save search |
| GET | `/search-history/list` | List history |
| POST | `/watchlist/add` | Add watchlist item |
| POST | `/watchlist/remove` | Remove (returns `ok`, `removed`, `message`) |
| GET | `/watchlist/list` | List watchlist |

**gRPC `BookingService` (`proto/booking.proto`):** `CreateBooking`, `ConfirmBooking`, `CancelBooking`, `GetBooking`.

---

## messaging-service (`services/messaging-service`)

**Role:** **Forum** (posts, comments, votes, attachments) and **DMs / groups / threads** with Redis caching and optional Kafka producers. **HTTP concurrency guard** (`MESSAGING_HTTP_MAX_CONCURRENT`, default 40) returns **503** when saturated.

**HTTP — health:**

| Method | Path |
|--------|------|
| GET | `/healthz`, `/health` |

**HTTP — forum** (mounted at `/forum` on service → `/api/messaging/forum` via gateway):

| Method | Path pattern |
|--------|----------------|
| GET, POST | `/posts` |
| GET, PUT, DELETE | `/posts/:postId` |
| POST | `/posts/:postId/vote` |
| GET, POST | `/posts/:postId/comments` |
| PUT, DELETE | `/comments/:commentId` |
| POST | `/comments/:commentId/vote` |
| POST, GET | `/posts/:postId/attachments`, `/comments/:commentId/attachments` |

**HTTP — messages** (mounted at `/messages` → `/api/messaging/messages`):

| Method | Path pattern |
|--------|----------------|
| GET | `/` (inbox), `/archived`, `/thread/:threadId` |
| POST | `/` (send), `/thread/:threadId/archive`, `/thread/:threadId/delete` |
| GET, POST | `/groups`, `/groups/:groupId`, `/groups/:groupId/members`, kick/ban/leave/delete group |
| GET, POST, PUT, DELETE | `/:messageId`, `/:messageId/reply`, `/:messageId/read`, `/:messageId/recall`, attachments |

**gRPC `MessagingService` (`proto/messaging.proto`):** forum + messaging RPCs (list/get/create/update/delete posts & comments, votes, list/send/reply/update/delete messages, thread, mark read, `HealthCheck`).

---

## notification-service (`services/notification-service`)

**Role:** **Notification preferences**, **inbox listing**, internal **cron heartbeat** for workers.

**HTTP:**

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/healthz`, `/health` | Health |
| GET | `/metrics` | Prometheus |
| POST | `/internal/cron/heartbeat` | Cron tick (e.g. from `cron-jobs`) |
| GET | `/preferences` | User prefs |
| PUT | `/preferences` | Update prefs |
| GET | `/notifications` | List notifications |

**gRPC `NotificationService` (`proto/notification.proto`):** `GetUserPreferences` (delivery is Kafka-driven; no “send” RPC in proto).

---

## trust-service (`services/trust-service`)

**Role:** **Abuse reports**, **peer review**, public **reputation** by user id.

**HTTP:**

| Method | Path |
|--------|------|
| GET | `/healthz`, `/health` |
| GET | `/metrics` |
| POST | `/report-abuse` |
| POST | `/peer-review` |
| GET | `/reputation/:userId` |

**gRPC `TrustService` (`proto/trust.proto`):** `FlagListing`, `ReportAbuse`, `SubmitReview`, `SubmitPeerReview`, `GetReputation`.

---

## analytics-service (`services/analytics-service`)

**Role:** **Daily metrics**, **internal listing-ingest** (from listings pipeline), **insights** (watchlist, search summary, listing “feel” with optional Ollama).

**HTTP:**

| Method | Path | Notes |
|--------|------|--------|
| GET | `/healthz`, `/health` | |
| GET | `/metrics` | |
| GET | `/daily-metrics` | Public on gateway (`OPEN_ROUTES`) |
| POST | `/internal/ingest/listing-created` | Guarded internal ingest |
| GET | `/insights/watchlist/:userId` | Optional auth |
| GET | `/insights/search-summary/:userId` | Self-only |
| POST | `/insights/listing-feel` | Optional JWT |

**gRPC `AnalyticsService` (`proto/analytics.proto`):** `GetDailyMetrics`, `GetRecommendations`, `GetWatchlistInsights`, `AnalyzeListingFeel`.  
**gRPC `RecommendationAdminService`:** `ActivateModel`, `SetExperimentTraffic` (admin / tooling, not necessarily exposed via gateway).

---

## media-service (`services/media-service`)

**Role:** **Presigned upload/download** over **gRPC**; HTTP server is **health-only** for probes and gateway `/media/healthz`.

**HTTP:** `GET /healthz` (JSON with DB connectivity).

**gRPC `MediaService` (`proto/media.proto`):** `CreateUploadUrl`, `CompleteUpload`, `GetDownloadUrl`.

---

## cron-jobs (`services/cron-jobs`)

**Role:** Scheduled **`POST`** to `NOTIFICATION_HEARTBEAT_URL` (e.g. notification-service `/internal/cron/heartbeat`) every 5 minutes. No HTTP server.

---

## @common/utils (`services/common`)

**Role:** Shared **npm workspace** package: auth helpers, gRPC clients, metrics, Kafka helpers, etc. **Not** a standalone runtime service.

---

## event-layer-verification (`services/event-layer-verification`)

**Role:** **Vitest** tests for Kafka / event contracts. **No** production HTTP or gRPC server.

---

## Webapp (`webapp/`)

**Role:** Next.js UI — not a backend microservice but the primary browser client.

**App routes (`app/*/page.tsx`):** `/` (home), `/login`, `/register`, `/dashboard`, `/listings`, `/analytics`, `/trust`, `/mission`. API calls go through **`/api/*`** on the edge URL (gateway).

---

## Maintenance

When you add routes or RPCs, update this file in the same PR. **Source of truth** remains the service `server.ts` / `http-server.ts` / `routes/*` and `proto/*.proto`.
