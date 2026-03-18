# Outbox publisher implementation

Each service that writes to an outbox table must run a **publisher worker** that drains unpublished rows and produces EventEnvelope messages to Kafka. This doc is the single implementation reference.

**Contract:** See docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md. Summary: payload = serialized proto bytes; envelope.event_id = outbox.id; Kafka key = aggregate_id.

---

## 1. ENV_PREFIX and topic name

- Read **ENV_PREFIX** from config (default `dev`). K8s app-config sets `ENV_PREFIX: "dev"`.
- Topic name = `${ENV_PREFIX}.${domain}.events`, e.g. `dev.booking.events`, `dev.listing.events`. Do not hardcode `dev` in service code.

---

## 2. Publisher loop (canonical)

**Correct flow (order is critical):**

1. **Publish to Kafka** (await produce success).
2. **If produce succeeded** → run `UPDATE <schema>.outbox_events SET published = true WHERE id = row.id`.
3. **Commit the DB transaction** (so the UPDATE is durable). Only then consider the row done.

**Do NOT:** Mark published before publish; commit the DB update before produce has succeeded; or publish outside the retry loop (on produce failure, do not update; next poll will retry the same row).

**Loop:**

1. **Poll:** `SELECT id, aggregate_id, type, version, payload, created_at FROM <schema>.outbox_events WHERE published = false ORDER BY created_at LIMIT N`.
2. **For each row:**
   - Build EventEnvelope:
     - `event_id` = `row.id` (UUID; do not generate a new one).
     - `type` = `row.type`.
     - `version` = `row.version`.
     - `source` = service name (e.g. `booking-service`).
     - `entity_id` = `row.aggregate_id`.
     - `timestamp` = `row.created_at` in ISO-8601.
     - `payload` = `row.payload` (already bytes; do not re-serialize).
   - **Produce** to the topic with **Kafka message key = row.aggregate_id**. Await success (or throw/retry).
   - **Only after successful produce:** `UPDATE <schema>.outbox_events SET published = true WHERE id = row.id`, then **commit the DB transaction**.
   - If produce fails: do not update; do not mark published; next iteration will retry this row.
3. **Sleep** (e.g. 500ms–2s) and repeat. On process crash, unmarked rows are republished; consumers dedupe by event_id.

---

## 3. Health check for Kafka

Services that use Kafka (publisher or consumer) should include Kafka in their health check so deployments can see connectivity.

- **common:** Use `checkKafkaConnectivity()` from `@common/kafka` (or equivalent). It connects an admin client and disconnects; returns true if reachable.
- **gRPC health:** Pass a health function that returns true only if DB and Kafka are OK, e.g. `async () => { await db.query('SELECT 1'); return await checkKafkaConnectivity(); }`, and register it with `registerHealthService(server, serviceName, healthCheckFn)`.

---

## 4. Where to run the publisher

- **Same process:** Start a background loop (setInterval or async loop) after the gRPC server is up.
- **Sidecar or separate job:** Alternatively run a small Node script that only does the outbox poll + produce loop and shares the same DB and Kafka config.

Do not block the main request path; the publisher is fire-and-forget after the transaction that wrote the outbox has committed.

---

## 5. Optional future hardening

- **Retry:** On produce failure, do not mark published; next poll will retry. Add exponential backoff and max retries if needed.
- **DLQ:** After N failures, move row to a dead-letter table or topic `${ENV_PREFIX}.<domain>.dlq` and mark published so the main topic is not blocked.

Nothing else. Freeze the event layer at this design.
