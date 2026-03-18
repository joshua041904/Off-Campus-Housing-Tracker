# Outbox publisher and consumer contract

This doc locks the discipline so publisher and consumer implementations stay correct. No drift.

---

## 1. Payload = serialized proto (not JSON)

- **Outbox column:** `payload BYTEA NOT NULL`
- **Meaning:** Store the **serialized domain event message** (e.g. `BookingCreatedV1` from `proto/events/booking.proto`) as Protobuf bytes. Do **not** store JSON.
- **Why:** Contract enforcement, strict typing, forward compatibility. Consumers deserialize with the same proto.

---

## 2. event_id = outbox.id (no new UUID on publish)

- **Outbox column:** `id UUID PRIMARY KEY` — this **is** the event_id.
- **Publisher must:** Set `envelope.event_id = outbox.id` when building the EventEnvelope. Do **not** generate a new UUID at publish time.
- **Why:** Stable event identity for idempotent consumers and replay; one canonical id per outbox row.

---

## 3. Partition key = entity_id (not event_id, not random)

- **Kafka message key:** Must be `entity_id` (the aggregate id: booking_id, listing_id, user_id, conversation_id for messaging, etc.). In outbox this is `aggregate_id`.
- **Publisher must:** Send the Kafka record with `key = aggregate_id` from the outbox row. Do **not** use event_id as key; do **not** use random or null key.
- **Why:** Ordering per aggregate; same entity’s events land in one partition and stay ordered.

---

## 4. Publisher worker flow (canonical)

**Order is critical:** (1) Publish to Kafka; (2) if success → UPDATE published = true; (3) commit DB transaction. Do not mark published before publish; do not commit the update before produce has succeeded.

1. In a loop (or scheduled job): `SELECT id, aggregate_id, type, version, payload, created_at FROM outbox_events WHERE published = false ORDER BY created_at`.
2. For each row:
   - Build EventEnvelope: `event_id = row.id`, `type = row.type`, `version = row.version`, `source = service name`, `entity_id = row.aggregate_id`, `timestamp = row.created_at` (ISO-8601), `payload = row.payload` (already bytes).
   - **Produce** to the correct topic (e.g. dev.booking.events) with **Kafka key = row.aggregate_id**. Await success.
   - **Only after successful produce:** `UPDATE outbox_events SET published = true WHERE id = row.id`, then **commit the DB transaction**.
   - On produce failure: do not update; next poll retries. Publish stays inside the loop.
3. On crash, unmarked rows are republished (at-least-once; idempotent consumers dedupe by event_id).

---

## 5. Consumer idempotency (mandatory)

Kafka is at-least-once. Every consumer **must** deduplicate by `event_id`.

- **Table:** `processed_events (event_id UUID PRIMARY KEY, processed_at TIMESTAMPTZ DEFAULT now())` in that service’s DB.
- **Before handling a message:**
  - `INSERT INTO processed_events (event_id) VALUES (envelope.event_id)` (or equivalent).
  - If conflict (event_id already present) → skip this message (already processed).
  - Else → process the event, then commit offset (or commit in same transaction as insert).

Analytics and notification already have `processed_events`. Listings (consumes listing.flagged) and trust (consumes booking.completed) have their own `processed_events` table; any other event consumer must use the same pattern.

---

## 6. Topic naming (parameterized)

- Use **ENV_PREFIX** so staging/prod don’t hardcode `dev`: `ENV_PREFIX="${ENV_PREFIX:-dev}"` then topics like `${ENV_PREFIX}.booking.events`.
- **Config:** K8s app-config sets `ENV_PREFIX: "dev"`; wire it through so publisher and consumer use the same value.
- Script: `scripts/create-kafka-event-topics.sh` uses ENV_PREFIX; services must use the same topic naming from config.

---

## Summary

| Rule | Requirement |
|------|-------------|
| Payload | Serialized proto bytes in outbox and in envelope.payload |
| event_id | envelope.event_id = outbox.id (never generate new UUID on publish) |
| Partition key | Kafka key = entity_id (= outbox.aggregate_id) |
| Consumers | processed_events + insert-before-handle; on conflict skip |
| Topics | ENV_PREFIX.booking.events etc.; no hardcoded env in code |

For messaging topic: outbox aggregate_id must be **conversation_id** so Kafka key = conversation_id (see docs/MESSAGING_KAFKA_ARCHITECTURE.md).

**Implementation:** Publisher worker steps → docs/OUTBOX_PUBLISHER_IMPLEMENTATION.md. Consumer idempotency wiring → docs/CONSUMER_WIRING.md. Health: use `checkKafkaConnectivity()` from `services/common` (Kafka) in the service health check when the service uses Kafka.
