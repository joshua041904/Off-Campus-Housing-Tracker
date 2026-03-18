# Kafka Strategy — Production-Grade Partitioning, Idempotency, and Retention

This doc defines **partitioning by entity key**, **idempotent consumer pattern**, **versioned topic naming**, and **retention by domain** so the platform is resume-grade and recruiter-ready.

---

## 1. Partitioning by entity key

**Rule:** `partition_key = entity_id` (e.g. `booking_id`, `listing_id`, `user_id`, `conversation_id`).

**Why:**
- Ordering guarantees per entity (no race conditions per booking/listing).
- Clean replay semantics per partition.
- Same entity always in same partition.

**Implementation:** Producers set the partition key from the event’s primary entity. Consumers that care about a single entity read from one partition. Use 6+ partitions per topic for parallelism; scale with broker count.

| Topic / event type   | Partition key   | Rationale                          |
|----------------------|-----------------|------------------------------------|
| housing.booking.v1.* | `booking_id`     | All events for one booking ordered |
| housing.listing.v1.* | `listing_id`    | All events for one listing ordered |
| housing.trust.v1.*   | `user_id` or `listing_id` | Per-entity ordering        |
| housing.messaging.v1.* | `conversation_id` | Per-conversation ordering       |

---

## 2. Idempotent consumer pattern (required)

Analytics and Notification **must** deduplicate by `event_id` so at-least-once delivery does not double-apply.

**Option A — processed_events table (recommended):**

```sql
CREATE TABLE IF NOT EXISTS <schema>.processed_events (
  event_id UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Flow:**
1. Consume message; read `event_id` from envelope.
2. `SELECT 1 FROM processed_events WHERE event_id = $1` (or insert with ON CONFLICT DO NOTHING).
3. If new → process event → insert `event_id` → commit offset.
4. If seen → skip → commit offset.

**Option B — processed_offsets (topic, partition, offset):** Possible but less robust than event_id (same offset can be reused after retention). Prefer event_id.

---

## 3. Topic naming (versioned, domain-scoped)

**Convention:** `housing.<domain>.v1.<event_type>`.

Examples:
- `housing.booking.v1.events` (or per-type: `housing.booking.v1.confirmed`, etc.)
- `housing.trust.v1.events`
- `housing.messaging.v1.events`
- `housing.listing.v1.events`
- `housing.notification.v1.events` (optional, for notification.sent)

**Benefits:** Versioned and evolvable; same topic name, increment version when breaking. Compatible with schema registry and resume language (“versioned event streams”).

---

## 4. Retention by domain criticality

| Domain      | retention.ms (example) | cleanup.policy | Rationale                    |
|-------------|-------------------------|----------------|-----------------------------|
| booking     | 1 209 600 000 (14 d)   | delete         | Operational; replay window  |
| listing     | 1 209 600 000 (14 d)    | delete         | Same                         |
| trust       | 2 592 000 000 (30 d)    | delete         | Moderation/audit longer      |
| messaging   | 1 209 600 000 (14 d)    | delete         | Operational                  |
| analytics   | 259 200 000 (3 d)       | delete         | Ingestion topic; short       |

Create topics explicitly with these configs; do not rely on broker defaults.

---

## 5. Event envelope (versioned, trace-ready)

Every event payload must use a **single envelope** so idempotency and tracing work across services.

```json
{
  "event_id": "uuid",
  "type": "booking.confirmed",
  "version": 1,
  "source": "booking-service",
  "entity_id": "booking-uuid",
  "timestamp": "2025-03-17T12:00:00Z",
  "data": { ... }
}
```

- **event_id:** Unique per event; used for `processed_events` dedup.
- **type:** Event type (e.g. `booking.confirmed`).
- **version:** Schema version of `data`; consumers branch on version.
- **source:** Producing service.
- **entity_id:** Partition key entity (booking_id, listing_id, etc.).
- **timestamp:** ISO-8601.
- **data:** Versioned payload; backward-compatible changes stay in same version; breaking changes bump version.

**Emit only after transaction commit.** Never emit before DB commit; never emit partial data.

---

## 6. Two-broker dev setup (replication-aware)

For local/dev:
- 2 brokers.
- `replication-factor=2`, `min.insync.replicas=1`.
- Same partitioning and client config as above.

Enables “designed Kafka cluster with replication-aware partitioning” without a large cluster.

---

## 7. Resume line

*Designed idempotent Kafka consumers with event_id deduplication, entity-key partitioning for ordering guarantees, versioned topic naming, and retention policies by domain criticality.*
