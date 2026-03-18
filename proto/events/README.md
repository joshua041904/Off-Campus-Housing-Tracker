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

- `${ENV_PREFIX}.booking.events` (default ENV_PREFIX=dev)
- `${ENV_PREFIX}.listing.events`
- `${ENV_PREFIX}.trust.events`
- `${ENV_PREFIX}.auth.events`
- `${ENV_PREFIX}.messaging.events`
- `${ENV_PREFIX}.notification.events`

Partition key = **entity_id** (never event_id or random). Envelope required. Create: `ENV_PREFIX=dev ./scripts/create-kafka-event-topics.sh`. See docs/KAFKA_STRATEGY.md and docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md.

## Transactional outbox

Each producing service DB has an `outbox_events` table (see infra/db/*-outbox.sql). Flow:

1. Write domain change + insert outbox row in the **same transaction**.
2. Commit.
3. Background worker reads unpublished rows, builds EventEnvelope, publishes to Kafka.
4. Mark published = true.

**Contract (mandatory):** Payload in outbox = **serialized proto bytes** (not JSON). **envelope.event_id = outbox.id** (no new UUID on publish). **Kafka message key = entity_id** (outbox.aggregate_id). See **docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md**. Implementation: **docs/OUTBOX_PUBLISHER_IMPLEMENTATION.md**, **docs/CONSUMER_WIRING.md**. Health: include Kafka connectivity (e.g. `checkKafkaConnectivity()` from common) for services that use Kafka.

## Consumer idempotency (mandatory)

Every consumer must deduplicate by event_id: table `processed_events (event_id UUID PRIMARY KEY, processed_at TIMESTAMPTZ)`. Before handling: INSERT event_id; ON CONFLICT skip. Analytics, notification, listings, and trust have this table; any new consumer must add it. See docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md.

## Topic naming (parameterized)

Topics use **ENV_PREFIX**: `${ENV_PREFIX:-dev}.booking.events`, etc. Create with `ENV_PREFIX=dev ./scripts/create-kafka-event-topics.sh` (or staging/prod). No hardcoded env in code.
