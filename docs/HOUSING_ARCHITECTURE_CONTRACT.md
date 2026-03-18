# Housing Architecture Contract

Single source of truth for how the Off-Campus-Housing-Tracker platform is structured: service boundaries, DB ownership, events, and rules. Use this for onboarding, Cursor rules, and design decisions.

---

## 1. Service and DB map

| Service | DB (port) | Owns | Does not own |
|---------|-----------|------|-------------------------------|
| **auth-service** | auth (5441) | users, sessions, MFA/passkeys | — |
| **listings-service** | listings (5442) | listings, listing_media, search_norm | booking, trust, availability |
| **booking-service** | bookings (5443) | bookings (request lifecycle) | listing rows, payment DB |
| **messaging-service** | messaging (5444) | conversations, conversation_participants, messages, read/archive state | booking rows, trust DB |
| **notification-service** | notification (5445) | user_preferences, notifications (delivery state) | booking/listing state, event storage (Kafka) |
| **trust-service** | trust (5446) | listing_flags, user_flags, reviews, reputation, user_suspensions | listing status, booking rows |
| **analytics-service** | analytics (5447) | events (immutable log), daily_metrics, user_activity | source-of-truth writes to other services |

**No cross-DB FKs.** Store foreign IDs as UUID references only. No dual writes: each service writes only to its own DB.

---

## 2. Mental model

- **Listings = creator-driven.** Landlord creates listing; listing service owns metadata, geo, search, status (including `flagged` when trust says so via event).
- **Booking = consumer-driven.** Tenant requests time on an asset they do not own. Booking service owns request lifecycle, overlap prevention, price snapshot, and completion.
- **Trust = post-fact.** Consumes `booking.completed` to allow reviews; emits `listing.flagged` when moderation resolves a flag; never writes to listing or booking DBs.
- **Notification = fan-out.** Consumes domain events; sends email/SMS/push; tracks delivery state and preferences; idempotent; never blocks user flows.
- **Analytics = event-sourcing.** Consumes all domain events; immutable event log + aggregates; never writes to other services or serves transactional queries.

---

## 3. Data and event rules

### Listings

- **Status:** ENUM `active | paused | closed | flagged`. `flagged` set only when listing service consumes `listing.flagged` from Kafka (trust never writes to listings DB).
- **Soft delete:** `deleted_at`; all reads use `deleted_at IS NULL`.
- **Location:** `latitude`, `longitude`; index for active, non-deleted.
- **Events emitted:** `listing.updated` (minimal: id, status, price_cents, version). No full row.

### Booking

- **Lifecycle:** created → pending_confirmation → confirmed | rejected | cancelled | expired → completed.
- **Overlap:** Enforced in booking DB with `btree_gist` EXCLUDE on `(listing_id, daterange(start_date, end_date))` for status in (`confirmed`, `pending_confirmation`).
- **Price:** `price_cents_snapshot` at booking time; never join to listing for price at payment.
- **Events emitted:** `booking.created`, `booking.confirmed`, `booking.rejected`, `booking.cancelled`, `booking.completed`, `booking.expired` (minimal payload: ids, dates, status).

### Trust

- **Listing flags:** listing_id, reporter_id, reason, description, status (pending → reviewed → resolved | dismissed). When resolved as confirmed → emit `listing.flagged`; listing service sets status=flagged. Trust does not touch listings DB.
- **User flags:** user_id, reporter_id, reason, description, status. Emit `user.warned` or `user.suspended`; other services react via events.
- **Reviews:** Post-booking only. Trust **consumes** `booking.completed`; allows review insert. Stores booking_id, reviewer_id, target_type (listing | user), target_id, rating, comment. Emits `review.created`; updates **reputation** table.
- **Reputation:** Materialized per-user (completed_bookings, positive/negative_reviews, flags_count, reputation_score). Updated on booking.completed, review created, user/listing flagged. Do not compute live.
- **Suspension:** trust.user_suspensions (user_id, reason, expires_at). Trust owns suspension state; emits `user.suspended` / `user.unsuspended`. Others enforce via policy or event.

### Messaging

- **Conversations:** Optional `listing_id`; optional `conversation_key` (e.g. hash of listing + tenant + landlord) to prevent duplicates. No cross-DB FK.
- **Participants:** Per-user `archived`, `deleted`, `last_read_at`. Archive = hide from inbox; delete = user no longer sees thread. Conversation remains for other participants.
- **Messages:** Soft delete only (`deleted_at`); app replaces body with "This message was deleted". `version` and `edited_at` on edit. Ordering by `(conversation_id, created_at DESC)`.
- **Read receipts:** Unread = messages where `created_at > participant.last_read_at` and `sender_id != current_user` and `deleted_at IS NULL`. No per-message read row unless needed later.
- **API:** Synchronous gRPC (CreateConversation, SendMessage, GetMessages, MarkAsRead, ArchiveConversation). Do not use Kafka for sending messages.
- **Events emitted:** `message.sent`, `message.deleted` (analytics, notification). Messaging does not consume its own events. Does not validate booking in DB — call booking via gRPC if needed.

### Notification

- **Fan-out consumer only.** Consumes domain events; does not own booking/listing state or validate business logic; never blocks user flows.
- **user_preferences:** Per-user (email_enabled, sms_enabled, push_enabled, booking_alerts, message_alerts, moderation_alerts). Check before sending.
- **notifications:** Every attempt stored (user_id, event_type, channel, status, payload JSONB, attempt_count, last_attempt_at). Status: pending → sent | failed | retrying. Idempotent processing; optional `notification.sent` event after delivery.
- **Flow:** Consume event → check preferences → insert row → attempt delivery → update status. Retries on failure. No cross-DB writes.

### Analytics

- **Fan-out consumer only.** Consumes all domain events; does not serve transactional queries or modify other services; never blocks flows.
- **events:** Immutable log (event_type, event_version, payload JSONB, source_service, created_at). Never update; delete only per retention policy. Payload as JSONB so event schema can evolve.
- **daily_metrics:** Precomputed per-date (new_users, new_listings, new_bookings, completed_bookings, messages_sent, listings_flagged). Updated on event consumption.
- **user_activity:** Optional per-user counters (listings_created, bookings_made, messages_sent) for dashboards. Project from events; do not normalize raw events into tables.

### Kafka

- **Topics:** `listing.updated`, `listing.flagged`, `booking.*`, `user.warned`, `user.suspended`, `user.unsuspended`, `review.created`, `reputation.updated`, `message.sent`, `message.deleted` (see KAFKA_TOPICS_AND_PARTITIONS.md).
- **Payload:** type, version, data (minimal fields). No full row; no schema lock-in.
- **Partition key:** `listing_id` or `booking_id` as appropriate (see KAFKA_TOPICS_AND_PARTITIONS.md).
- **Strict TLS:** All clients SSL; mTLS where required; no plaintext to other services.

---

## 4. API and transport

- **gRPC + HTTP:** API gateway; strict TLS; mTLS for gRPC where configured.
- **Auth:** JWT from auth-service; `sub` = user id; services use it as tenant_id / landlord_id / user_id (no cross-DB lookup required for identity).
- **Service-to-service:** mTLS mandatory; internal identity via x-service-name + cert CN validation; capability matrix (who may call whom). **Errors:** gRPC status codes only; structured detail; no boolean success flags; uniform error logging. See **docs/SERVICE_AUTH_AND_ERRORS.md**.

---

## 5. What we do not do

- No cross-service DB writes (no trust writing to listings, no listing writing to booking).
- No shared tables across services.
- No FK across databases.
- No full-row or PII-heavy event payloads; minimal events only.
- No availability/reservation tables in listings DB; booking service owns all reservation state.

---

## 6. Schema and scripts

- **Listings:** `infra/db/01-listings-schema-and-tuning.sql`, `02-listings-pgbench-trigram-knn.sql`; apply with `scripts/ensure-listings-schema.sh`.
- **Booking:** `infra/db/01-booking-schema.sql`; run against DB `bookings` (5443).
- **Trust:** `infra/db/01-trust-schema.sql`; run against DB `trust` (5446).
- **Messaging:** `infra/db/01-messaging-schema.sql`; run against DB `messaging` (5444).
- **Notification:** `infra/db/01-notification-schema.sql`; run against DB `notification` (5445).
- **Analytics:** `infra/db/01-analytics-schema.sql`; run against DB `analytics` (5447).
- **Topics and partitions:** `docs/KAFKA_TOPICS_AND_PARTITIONS.md`.

---

## 7. Local dev and dumps

- Each dev can run local Postgres (compose: 5441–5447). Distribute seed dumps per DB (e.g. `pg_dump -Fc -d listings > listings.dump`); teammates restore with `pg_restore --clean --if-exists -d listings listings.dump`. No shared live DB requirement.

---

This contract is the single reference for “how housing is built.” Keep it updated when adding services, topics, or ownership rules.
