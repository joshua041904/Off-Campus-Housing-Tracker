# Database schemas (raw Postgres)

Auth (5441) is Prisma + optional restore. Listings (5442), **Booking (5443)**, **Messaging (5444)**, **Notification (5445)**, **Trust (5446)**, and **Analytics (5447)** are raw Postgres with SQL in this folder. See **docs/HOUSING_ARCHITECTURE_CONTRACT.md** for service/DB map and rules.

**One-shot setup (all DBs, ports per table below):**  
`PGPASSWORD=postgres ./scripts/setup-all-dbs.sh` — runs all ensure-*-schema scripts for listings, bookings, messaging, notification, trust, analytics. Auth is skipped (Prisma/restore). Optional: `DO_DOCKER_UP=1` to start the seven Postgres containers first. **Media (5448)** is optional: run `./scripts/ensure-media-schema.sh` when media-service is used (create DB `media` on port 5448 or add postgres-media to docker-compose).

## Auth (5441) — how login works

- **Database:** `auth` on port **5441** (postgres-auth in docker-compose).
- **Schema:** `auth`. Main table: `auth.users` with `id` (UUID), `email` (CITEXT), `password_hash`, `email_verified`, `phone_verified`, `mfa_enabled`, `created_at`, `updated_at`. Login: lookup by email, verify password (bcrypt), then issue JWT. No MFA step in current flow.
- **Restore:** Use `backups/5437-auth.dump` → 5441 with `scripts/restore-auth-from-legacy-dump.sh` (see `backups/README.md`).

Listings store **user_id** (UUID) referencing the lister; auth lives on another instance so there is no cross-database FK. Flow: user registers/logs in on auth (5441) → receives JWT with `sub` = user id → listings service uses that `sub` as `user_id` when creating or editing listings (5442).

## Listings (5442)

- **Database:** `listings` on port **5442** (postgres-listings).
- **Schema:** `listings`. Tables: `listings.listings`, `listings.listing_media`. Applied by `scripts/ensure-listings-schema.sh` or manually:
  ```bash
  PGPASSWORD=postgres psql -h 127.0.0.1 -p 5442 -U postgres -d listings -f infra/db/01-listings-schema-and-tuning.sql
  ```

Files:

- `00-create-listings-database.sql` — Create DB `listings` (optional; docker-compose already creates it).
- `01-listings-schema-and-tuning.sql` — Schema, tables, indexes (composite, partial, GIN trigram on `search_norm`, hash where useful). Includes `pg_trgm` and `search_norm` + trigger for fuzzy search.
- `02-listings-pgbench-trigram-knn.sql` — Trigram/KNN-style search: `listings.norm_text()`, `listings.search_listings_fuzzy_ids()`, `listings.search_listings_fuzzy_count()` for pgbench. Optional: commented vector/HNSW for ANN (pgvector).

**pgbench:** After schema is applied, run `./scripts/run_listings_pgbench_sweep.sh` (trigram + search variants). Requires local pgbench (e.g. `brew install postgresql@16`).

### Listings schema discipline (01)

- **Status:** ENUM `listings.listing_status` (`active`, `paused`, `closed`, `flagged`). No typo bugs; clean proto mapping.
- **Trust:** No cross-DB write. Listing service **consumes** Kafka `listing.flagged` and sets `status = 'flagged'` in this DB only. Trust service never writes to listings DB.
- **Soft delete:** `deleted_at TIMESTAMPTZ`; all reads use `WHERE deleted_at IS NULL`. History preserved for analytics.
- **Location:** `latitude`, `longitude` (DOUBLE PRECISION) for distance-from-campus and map. Index `idx_listings_lat_lon` for active, non-deleted.
- **Booking:** Availability and reservation logic live in **booking-service DB only**. Listings DB is metadata; no booking table here.
- **Search:** Trigram on `search_norm` only; no redundant tsvector GIN (keeps write cost down).
- **Optimistic lock:** `version` incremented on every UPDATE (trigger). Use in API/gRPC for concurrent edits and trust updates.
- **Events:** On listing change, emit minimal Kafka payload (e.g. `listing.updated` with `id`, `status`, `price_cents`, `version`). Do not emit full row.

## Optional schemas / ideas for listings

- **listing_favorites** — user_id, listing_id, created_at (for “saved” listings).
- **listing_views** — listing_id, viewed_at, optional user_id (for analytics).
- **neighborhoods** — id, name, slug, bounds (polygon or box) for geo filters. (Availability/booking slots live in **booking-service** DB only.)
- **Vector ANN (HNSW):** In `02-listings-pgbench-trigram-knn.sql`, uncomment the `vector` extension and `embedding` column + HNSW index for semantic search (e.g. pgvector). Then add `search_listings_knn_ann(user_id, query_embedding, lim)` that orders by `embedding <=> query_embedding`.
- **Outbox (03):** `03-listings-outbox.sql` — transactional outbox; payload = serialized proto bytes; publisher sets envelope.event_id = outbox.id, Kafka key = aggregate_id. See docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md.
- **Processed events (04):** `04-listings-processed-events.sql` — idempotent consumer table (listings consumes e.g. listing.flagged from trust). Applied by ensure-listings-schema.sh after 03.

## Booking (5443)

- **Database:** `bookings` on port **5443** (postgres-bookings). Consumer-driven request lifecycle; tenant requests time on listing.
- **Schema:** `booking`. Table: `booking.bookings` with listing_id, tenant_id, landlord_id (auth user UUIDs; no cross-DB FK), start_date, end_date, status enum, price_cents_snapshot, version. Overlap prevention via `btree_gist` EXCLUDE on (listing_id, daterange).
- **Apply:** `PGPASSWORD=postgres ./scripts/ensure-booking-schema.sh` or `psql -h 127.0.0.1 -p 5443 -U postgres -d bookings -f infra/db/01-booking-schema.sql`
- **State machine (02):** `infra/db/02-booking-state-machine.sql` enforces legal transitions (created → pending_confirmation | cancelled; pending_confirmation → confirmed | rejected | cancelled | expired; confirmed → completed | cancelled). Terminal states allow no further changes. Applied by ensure-booking-schema.sh after 01.
- **Events:** booking-service emits `booking.created`, `booking.confirmed`, `booking.rejected`, `booking.cancelled`, `booking.completed`, `booking.expired` (minimal payload). See docs/KAFKA_TOPICS_AND_PARTITIONS.md.

## Messaging (5444)

- **Database:** `messaging` on port **5444** (postgres-messaging). WhatsApp-style: conversations, participants, messages, read/archive state, soft delete only.
- **Schema:** `messaging`.
  - **conversations** — id, listing_id (optional), conversation_key (optional, unique), created_at, updated_at.
  - **conversation_participants** — (conversation_id, user_id) PK, joined_at, archived, deleted, last_read_at. Per-user archive/delete; never delete conversation globally.
  - **messages** — id, conversation_id, sender_id, body, message_type, created_at, edited_at, deleted_at, version. Optional **media_id** (04-messaging-media-id.sql). Soft delete only; unread = count where created_at > last_read_at and sender_id != current user and deleted_at IS NULL.
- **Rate limit (optional):** 05-messaging-rate-limit.sql — DB-backed sliding window `message_rate_limit (user_id, window_start, count)`. Prefer **Redis** (key `rate:msg:{user_id}`, INCR, EXPIRE 60s; max 30/min, 500/day). See docs/MESSAGING_RATE_LIMIT_AND_SPAM.md.
- **Apply:** `PGPASSWORD=postgres ./scripts/ensure-messaging-schema.sh` or `psql -h 127.0.0.1 -p 5444 -U postgres -d messaging -f infra/db/01-messaging-schema.sql` then 02, 04; optionally 05 if not using Redis.
- **API:** Synchronous gRPC; Kafka only for events `message.sent`, `message.deleted` (analytics, notification). Does not validate booking in DB — call booking via gRPC if needed.

## Notification (5445)

- **Database:** `notification` on port **5445** (postgres-notification). Fan-out consumer: preferences + delivery state only; does not own booking/listing state.
- **Schema:** `notification`.
  - **user_preferences** — user_id PK, email_enabled, sms_enabled, push_enabled, booking_alerts, message_alerts, moderation_alerts, updated_at.
  - **notifications** — id, user_id, event_type, channel (email|sms|push), status (pending|sent|failed|retrying), payload JSONB, attempt_count, last_attempt_at, created_at. Every attempt stored; idempotent processing.
- **Apply:** `PGPASSWORD=postgres ./scripts/ensure-notification-schema.sh` or `psql -h 127.0.0.1 -p 5445 -U postgres -d notification -f infra/db/01-notification-schema.sql`
- **Flow:** Consume event → check preferences → insert → attempt delivery → update status. Optional `notification.sent` event. No cross-DB writes; never block domain flows.

## Trust (5446)

- **Database:** `trust` on port **5446** (postgres-trust). Moderation, flags, reviews, reputation, suspension. No cross-DB writes; Trust only emits events.
- **Schema:** `trust`.
  - **listing_flags** — listing_id, reporter_id, reason, description, status (pending → reviewed → resolved | dismissed), reviewed_by, reviewed_at. When resolved as confirmed → emit `listing.flagged`; listing service sets status=flagged.
  - **user_flags** — user_id, reporter_id, reason, description, status. Emit `user.warned` / `user.suspended` as needed.
  - **reviews** — booking_id, reviewer_id, target_type (listing | user), target_id, rating 1–5, comment. Only after `booking.completed`; Trust consumes event and stores review; emits `review.created`, updates **reputation**.
  - **reputation** — user_id PK, completed_bookings, positive_reviews, negative_reviews, flags_count, reputation_score (NUMERIC 0–5), updated_at. Materialized; updated on booking.completed, review created, flags.
  - **user_suspensions** — user_id, reason, suspended_at, expires_at, suspended_by. Trust owns suspension state; emits `user.suspended` / `user.unsuspended`.
- **Scoring (02):** `infra/db/02-trust-scoring.sql` adds deterministic formula: score = LEAST(GREATEST(average_rating*0.6 + completed_bookings*0.2 - flags_count*0.3, 0), 5). Trigger recomputes on insert/update of reputation row. Applied by ensure-trust-schema.sh after 01.
- **Outbox (03):** `03-trust-outbox.sql` — transactional outbox; payload = serialized proto bytes; publisher sets envelope.event_id = outbox.id, Kafka key = aggregate_id.
- **Processed events (04):** `04-trust-processed-events.sql` — idempotent consumer table (trust consumes e.g. booking.completed from booking). Applied by ensure-trust-schema.sh after 03.
- **Spam score (05):** `05-trust-spam-score.sql` — user_spam_score (user_id, score, updated_at) for MessageSentV1 consumption; threshold → UserSuspendedV1. Applied by ensure-trust-schema.sh after 04.
- **Apply:** `PGPASSWORD=postgres ./scripts/ensure-trust-schema.sh` or `psql -h 127.0.0.1 -p 5446 -U postgres -d trust -f infra/db/01-trust-schema.sql`

## Analytics (5447)

- **Database:** `analytics` on port **5447** (postgres-analytics). Fan-out consumer: immutable event log + precomputed aggregates; does not serve transactional queries or write to other services.
- **Schema:** `analytics`.
  - **events** — id, event_type, event_version, payload JSONB, source_service, created_at. Immutable; never update; delete only per retention. Payload as JSONB so event schema can evolve.
  - **daily_metrics** — date PK, new_users, new_listings, new_bookings, completed_bookings, messages_sent, listings_flagged, updated_at. Updated on event consumption.
  - **user_activity** — user_id PK, listings_created, bookings_made, messages_sent, updated_at. Optional; for dashboards.
  - **recommendation_models / recommendation_weights / recommendation_experiments** — versioned models, per-model weights, and experiments for traffic-split recommendations.
- **Apply:** `PGPASSWORD=postgres ./scripts/ensure-analytics-schema.sh` or `psql -h 127.0.0.1 -p 5447 -U postgres -d analytics -f infra/db/01-analytics-schema.sql`
- **Discipline:** Consume all domain events; project into aggregates. Do not normalize raw events into fixed columns; store payload as JSONB.
- **Projections (02):** `infra/db/02-analytics-projections.sql` adds `event_id` (unique) on events, `processed_events` (idempotency), `projection_state`, `projection_versions` for replay and versioned rebuilds. Applied by `ensure-analytics-schema.sh` after 01.
- **Notification idempotency (02):** `infra/db/02-notification-idempotency.sql` adds `notification.processed_events` for event_id dedup. Applied by `ensure-notification-schema.sh` after 01.
- **Recommendations (03):** `infra/db/03-analytics-recommendation.sql` adds recommendation_models, recommendation_weights, recommendation_experiments for versioned ranking and experiments. Applied by `ensure-analytics-schema.sh` after 02.

## Media (5448, optional)

- **Database:** `media` on port **5448**. Optional; add postgres-media to docker-compose or create DB manually when media-service is used.
- **Schema:** `media`. **media_files** — id (= media_id), user_id, object_key, filename, content_type, size_bytes, status (pending | uploaded | failed), created_at, updated_at. Blobs in MinIO/S3; metadata only here.
- **Outbox (02):** `02-media-outbox.sql` — after CompleteUpload, insert MediaUploadedV1; publisher produces to ${ENV_PREFIX}.media.events.
- **Apply:** `PGPASSWORD=postgres ./scripts/ensure-media-schema.sh` or `psql -h 127.0.0.1 -p 5448 -U postgres -d media -f infra/db/01-media-schema.sql` then 02-media-outbox.sql. See docs/MEDIA_SERVICE_DESIGN.md.

## Kafka and architecture

- **Topics and partitions:** docs/KAFKA_TOPICS_AND_PARTITIONS.md (ENV_PREFIX for topic names; partition key = entity_id).
- **Publisher and consumer contract:** docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md — payload = proto bytes; envelope.event_id = outbox.id; Kafka key = entity_id; every consumer uses processed_events.
- **Contract (service boundaries, events, no dual writes):** docs/HOUSING_ARCHITECTURE_CONTRACT.md
