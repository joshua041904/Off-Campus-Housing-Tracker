# Event contracts (Kafka payloads)

**Strong discipline:** All Kafka messages are serialized **EventEnvelope**. No raw domain messages on topics. RPC contracts (repo root `proto/*.proto`) stay untouched; events are isolated here.

## Envelope (mandatory)

- **envelope.proto** — `EventEnvelope`: event_id, type, version, source, entity_id, timestamp, payload (bytes). Every producer serializes the domain message into `payload` and wraps it in EventEnvelope. Partition key = entity_id.

## Domain event protos (versioned)

| File | Package | Messages |
|------|---------|----------|
| auth.proto | events.auth | UserCreatedV1, UserDeletedV1, UserRoleUpdatedV1, UserSuspendedV1 |
| booking.proto | events.booking | BookingCreatedV1, BookingConfirmedV1, BookingCancelledV1, BookingCompletedV1 |
| listing.proto | events.listing | ListingCreatedV1, ListingUpdatedV1, ListingDeletedV1, ListingPriceUpdatedV1 |
| trust.proto | events.trust | ListingFlaggedV1, ListingUnflaggedV1, ReviewCreatedV1, UserReputationUpdatedV1 |
| messaging.proto | events.messaging | ConversationCreatedV1, MessageSentV1, MessageReadV1 |
| notification.proto | events.notification | NotificationSentV1 (optional emit) |

Backward compatible only; breaking changes = new version (e.g. BookingCreatedV2).

## Topics (domain + envelope)

- dev.booking.events
- dev.listing.events
- dev.trust.events
- dev.auth.events
- dev.messaging.events
- dev.notification.events

Partition key = entity_id. Envelope required. See docs/KAFKA_STRATEGY.md and docs/EVENT_VERSIONING_AND_TRACING.md.

## Transactional outbox

Each producing service DB has an `outbox_events` table (see infra/db/*-outbox.sql). Flow:

1. Write domain change + insert outbox row in the **same transaction**.
2. Commit.
3. Background worker reads unpublished rows, serializes payload into EventEnvelope, publishes to Kafka.
4. Mark published = true.

No Debezium, no distributed transactions. Correct, deterministic, production-grade.
