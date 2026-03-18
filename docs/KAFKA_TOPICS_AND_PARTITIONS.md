# Kafka Topics and Partition Strategy (Housing)

Strict TLS + mTLS; single broker (Docker 29094) or multi-broker later. This doc locks down **topic names**, **partition keys**, and **consumer groups** for the housing platform.

**Production-grade strategy:** See **docs/KAFKA_STRATEGY.md** for entity-key partitioning, idempotent consumers (`processed_events`), versioned topic naming (`housing.<domain>.v1.*`), retention by domain, and event envelope (event_id, version, source, entity_id, timestamp).

---

## Topic naming

- **Domain.event** (lowercase, dot).
- One topic per event type (or small, cohesive group) so consumers can subscribe narrowly.

---

## Housing topics

| Topic | Producer | Consumers | Partition key | Partitions (single broker) |
|-------|----------|-----------|---------------|----------------------------|
| **listing.updated** | listing-service | analytics-service, notification-service (optional) | `listing_id` | 6 |
| **listing.flagged** | trust-service | listing-service | `listing_id` | 6 |
| **booking.created** | booking-service | notification-service, analytics-service | `listing_id` | 6 |
| **booking.confirmed** | booking-service | notification-service, trust-service (allow review) | `booking_id` | 6 |
| **booking.rejected** | booking-service | notification-service | `booking_id` | 6 |
| **booking.cancelled** | booking-service | notification-service | `booking_id` | 6 |
| **booking.completed** | booking-service (cron or on transition) | trust-service (reviews), analytics-service | `booking_id` | 6 |
| **booking.expired** | booking-service (cron) | notification-service (optional) | `booking_id` | 6 |
| **user.warned** | trust-service | notification-service, auth-service (optional) | `user_id` | 6 |
| **user.suspended** | trust-service | listing-service, booking-service, auth-service | `user_id` | 6 |
| **user.unsuspended** | trust-service | listing-service, booking-service, auth-service | `user_id` | 6 |
| **review.created** | trust-service | analytics-service, listing-service (rating snapshot) | `target_id` or `booking_id` | 6 |
| **reputation.updated** | trust-service | analytics-service (optional) | `user_id` | 6 |
| **message.sent** | messaging-service | analytics-service, notification-service (push) | `conversation_id` | 6 |
| **message.deleted** | messaging-service | analytics-service (optional) | `conversation_id` | 6 |
| **notification.sent** | notification-service (optional) | analytics-service | `user_id` | 6 |

**Note:** Trust-service emits listing.flagged, user.warned, user.suspended, user.unsuspended, review.created, reputation.updated. Messaging-service emits message.sent, message.deleted (synchronous send is over gRPC; events for analytics/push only). Consumers never write to other services’ DBs.

**Why partition by `listing_id` for listing/booking events:**  
All events about the same listing (or booking) stay in order per partition; consumers that care about a single listing get ordering. Use 6 partitions as a minimum for parallelism; scale with broker count later.

---

## Domain event topics (dev.*.events) + EventEnvelope

**Strong discipline:** One topic per domain; every message is a serialized **EventEnvelope** (see **proto/events/envelope.proto**). No raw domain messages on topics. Partition key = **entity_id**.

| Topic | Producer | Partition key | Event protos |
|-------|----------|---------------|--------------|
| **dev.booking.events** | booking-service | entity_id (booking_id) | proto/events/booking.proto |
| **dev.listing.events** | listings-service | entity_id (listing_id) | proto/events/listing.proto |
| **dev.trust.events** | trust-service | entity_id | proto/events/trust.proto |
| **dev.auth.events** | auth-service | entity_id (user_id) | proto/events/auth.proto |
| **dev.messaging.events** | messaging-service | entity_id (conversation_id / message_id) | proto/events/messaging.proto |
| **dev.notification.events** | notification-service (optional) | entity_id | proto/events/notification.proto |

EventEnvelope fields: event_id, type, version, source, entity_id, timestamp, payload (bytes = serialized domain message). Create topics with **scripts/create-kafka-event-topics.sh** (or equivalent). Transactional outbox: see **proto/events/README.md** and **infra/db/*-outbox.sql**.

---

## Event payload contract (minimal)

- **type:** string (e.g. `listing.updated`, `booking.confirmed`).
- **version:** integer (schema version of payload).
- **data:** object with only required fields (ids, status, dates). **Do not** emit full row or PII beyond what the consumer needs.

Example:

```json
{
  "type": "booking.confirmed",
  "version": 1,
  "data": {
    "booking_id": "uuid",
    "listing_id": "uuid",
    "tenant_id": "uuid",
    "landlord_id": "uuid",
    "start_date": "YYYY-MM-DD",
    "end_date": "YYYY-MM-DD"
  }
}
```

---

## Consumer groups

- **listing-service:** `listing-service-group` (consumes `listing.flagged` only; updates own DB).
- **trust-service:** `trust-service-group` (consumes `booking.completed`; allows post-booking review).
- **notification-service:** `notification-service-group` (consumes booking.*, message.sent for push, optional listing.updated).
- **analytics-service:** `analytics-service-group` (consumes listing.updated, booking.*, message.sent, message.deleted; event-sourcing only, no DB write to other services).

No dual writes: each service writes only to its own DB; cross-domain flow is via events.

---

## Partition strategy (multi-broker later)

- **listing_id / booking_id** as partition key (hash) so same entity is ordered; spread load across partitions.
- **Default replication factor:** 2 or 3 when cluster has multiple brokers (see KAFKA_CURRENT_AND_ROADMAP.md).
- **Create topics explicitly** (e.g. `kafka-topics.sh --create ...`) with desired partition count and replication; do not rely on auto-create for production.

---

## Strict TLS + mTLS

- All clients use SSL (port 9093 / host 29094 for housing).
- mTLS required on broker; clients present client cert (see STRICT_TLS_MTLS_AND_KAFKA.md).
- No plaintext ports exposed to other services.
