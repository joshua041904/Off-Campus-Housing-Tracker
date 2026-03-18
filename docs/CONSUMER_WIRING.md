# Consumer wiring (idempotent pattern)

Every service that consumes from the domain event topics **must** use the idempotent pattern. Kafka is at-least-once; without deduplication you get duplicate side effects.

**Contract:** See docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md. This doc is the implementation reference for consumers.

---

## 1. processed_events table

Each consumer service DB has a table:

```sql
CREATE TABLE <schema>.processed_events (
  event_id     UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Already present in: **analytics** (02-analytics-projections.sql), **notification** (02-notification-idempotency.sql), **listings** (04-listings-processed-events.sql), **trust** (04-trust-processed-events.sql). Any new consumer must add the same.

---

## 2. Consume loop (canonical)

1. **Poll** Kafka for the topic(s) this service consumes.
2. **For each message:**
   - Deserialize the value as EventEnvelope; read `event_id`.
   - **Dedupe:** `INSERT INTO <schema>.processed_events (event_id) VALUES ($1) ON CONFLICT (event_id) DO NOTHING RETURNING event_id`. If no row returned → already processed → **skip** (ack offset and continue).
   - **Process** the event (e.g. update local DB, emit side effects).
   - **Commit offset** only after successful process (or in the same transaction as the INSERT if you process synchronously in one tx).

Use a single transaction for INSERT + domain update when possible so that “processed” and “effect” are atomic. If you process in a separate step, commit offset only after the effect is applied.

---

## 3. Wire ENV_PREFIX and topic names

- Subscribe to topics using **ENV_PREFIX** from config: e.g. `${ENV_PREFIX}.booking.events`, `${ENV_PREFIX}.trust.events`. Do not hardcode `dev`.

---

## 4. Health check for Kafka

Consumers that depend on Kafka should include Kafka in their health check (e.g. `checkKafkaConnectivity()` from common) so readiness fails if Kafka is unreachable. Register with `registerHealthService(server, serviceName, healthCheckFn)`.

---

## 5. Summary

- **Before handle:** INSERT event_id into processed_events; on conflict skip.
- **After handle:** Commit offset (and optionally update projection_state or similar).
- **Topics:** Use ENV_PREFIX in topic names.
- **Health:** Include Kafka connectivity in the service health check.

No additional layers. This pattern is sufficient for at-least-once delivery and exactly-once effect.
