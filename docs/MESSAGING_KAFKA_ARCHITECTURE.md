# Messaging + Kafka architecture (correct model)

This doc locks how messaging uses Kafka: **Kafka is the event backbone, not chat transport.** It aligns with the outbox discipline, break-tested event spine, and TLS/mTLS posture.

---

## One-sentence summary

**Messaging is synchronous (gRPC). Kafka is asynchronous fanout (side-effect propagation).**

---

## Messaging service responsibilities

| Concern | How |
|--------|-----|
| Send message | gRPC |
| Store message | Postgres |
| Read messages | gRPC |
| Read receipts | Postgres (`last_read_at`) |
| Emit domain event | Kafka (via outbox) |
| Analytics | Kafka consumer (other service) |
| Notifications | Kafka consumer (other service) |

Kafka is **side-effect propagation**, not chat delivery.

---

## What Kafka is NOT doing

Kafka is **not**:

- Delivering chat to clients
- Triggering UI updates
- Powering read receipts
- Acting as RPC
- Acting as message broker between users

All chat reads stay in Postgres. Messaging service does **not** consume its own topic.

---

## When user sends a message (flow)

1. **gRPC** → `SendMessage`
2. Insert into `messaging.messages`
3. Insert into `messaging.outbox_events` (payload = serialized **MessageSentV1**)
4. Commit DB transaction
5. Publisher loop (background) reads outbox
6. Produces **EventEnvelope** to **`${ENV_PREFIX}.messaging.events`**
   - **Kafka key = `conversation_id`** (so all messages in the same conversation are ordered; different conversations spread across partitions)

Then:

- **Analytics** consumes it (engagement, landlord/tenant responsiveness, latency)
- **Notification** consumes it (push/email for first message, replies, “unread”)
- **Trust** may consume it (abuse/spam detection, rate-limit)
- **Messaging service itself does NOT consume it**

---

## Why use Kafka for messaging?

- **Analytics:** message.sent per day, engagement, responsiveness, response latency
- **Notification:** push/email for first message, landlord reply, “you have unread messages”
- **Moderation / Trust:** spam, harassment patterns, rate-limit message storms

All without coupling to the messaging service. Consumers live elsewhere.

---

## Partition key and scaling

- **Topic:** `${ENV_PREFIX}.messaging.events` (e.g. `dev.messaging.events`)
- **Partitions:** 6 is good. Partition key = **conversation_id** (outbox `aggregate_id` for messaging = conversation_id).

Guarantees:

- All messages in the **same conversation** are ordered (same partition).
- Different conversations distribute across partitions (parallelism).

Do **not** use `message_id` as key. Do **not** use random or null key.

**Consumer scaling:**

- **Analytics:** one consumer group, multiple replicas; Kafka balances partitions.
- **Notification:** separate consumer group; can scale horizontally.
- **Messaging service:** no consumer inside messaging.

---

## Payload discipline

Messaging is high-frequency. Keep payload small:

- **No message content in events** (MessageSentV1 already has only: message_id, conversation_id, sender_id, recipient_id, sent_at).
- No gigantic envelope. EventEnvelope + small payload only.

---

## Exactly-once semantics (reality)

**Exactly-once** here means **exactly-once processing effect**, not exactly-once delivery.

With the current architecture:

- Outbox
- Idempotent consumers (`processed_events`, insert event_id before handle, on conflict skip)
- Partition key discipline

You already have **effectively exactly-once**: producer can duplicate; consumer dedupes; side-effects happen once. Industry-standard.

**Do NOT add:**

- Kafka transactions
- Idempotent Kafka producer with EOS mode
- Two-phase commit
- Cross-service transactions
- Saga orchestrator for messaging
- Distributed locking

Those are complexity multipliers. The current model is correct and mature.

---

## Messaging service final design

- gRPC server (strict TLS + mTLS)
- Postgres DB
- Outbox table
- Publisher worker
- Kafka producer (TLS)
- Health check (DB + Kafka)
- **No consumer inside messaging**

Consumers live elsewhere. That’s clean.

---

## Media (video/file) architecture

- **Do not** store video in Postgres.
- **Do not** stream video via gRPC.
- **Do not** push media via Kafka.

**Split:**

- **Messaging service:** stores message metadata, references `media_id`; emits events (no media bytes).
- **Media service:** handles upload, storage, issues signed URLs; emits `media.uploaded` event.

**Flow for sending message with media:**

1. Client uploads file to **Media service**
2. Media service stores in object storage (S3/MinIO)
3. Media service returns `media_id`
4. Client calls `SendMessage` with `content` (optional text) and `media_id`
5. Messaging stores: message_id, conversation_id, sender_id, content, media_id, sent_at
6. Outbox emits MessageSentV1 (no media bytes in Kafka/Postgres/gRPC payload)

**Media service responsibilities (minimal):**

- UploadFile (stream or chunked)
- GeneratePresignedUploadURL
- GeneratePresignedDownloadURL
- Validate file type
- Virus scan (future)
- Emit `media.uploaded` event

Storage: MinIO (local/Colima), S3 (prod), GCS (optional).

---

## gRPC and HTTP/3

- gRPC (Node, Go) runs over **HTTP/2**.
- HTTP/3 is QUIC; gRPC-over-QUIC is not mainstream in Node.
- **Setup:** Caddy can expose HTTP/3; internally services use HTTP/2; gateway may expose HTTP/3 externally. That is fine.
- **Do not** attempt gRPC streaming over HTTP/3 manually. Keep unary RPC, clean contracts, strict TLS.

---

## DLQ strategy

- Add **`${ENV_PREFIX}.messaging.dlq`** (and similarly for other domains if needed).
- If a consumer fails N times: publish envelope to DLQ, log, alert.
- Do not auto-retry forever.

---

## Observability (metrics)

Expose Prometheus metrics (e.g. prom-client).

**Messaging service:**

- `messages_sent_total`
- `conversation_count` / `active_conversations`
- `db_latency`
- `kafka_publish_latency`

**Media service:**

- `uploads_total`
- `upload_failures`
- `upload_bytes_total`

**Notification:**

- `notifications_sent_total`
- `failures_total`

---

## Break tests (event spine)

The event-layer break tests verify:

- Crash after produce → row stays unpublished; restart republishes; consumer dedupes
- Crash after UPDATE before commit → rollback; retry works
- Kafka down → publish fails; published stays false; health NOT_SERVING; when Kafka back, retries succeed

No event loss, at-least-once delivery, deterministic retry, idempotent consumers, correct health and restart behavior. Production-grade discipline.

---

## Final architecture snapshot

- gRPC-only contracts
- Strict TLS everywhere, mTLS where required
- Outbox pattern, envelope discipline
- Partition key = entity_id (conversation_id for messaging)
- ENV_PREFIX discipline
- Idempotent consumers, break-tested event spine
- Media separation (metadata + media_id in messaging; bytes in media service)
- Clean domain topic separation
- No distributed transactions, no choreography chaos, no Kafka misuse, no streaming overkill

Refs: [OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md](OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md), [EVENT_LAYER_STABILITY.md](EVENT_LAYER_STABILITY.md), [ARCHITECTURE_RULES.md](../ARCHITECTURE_RULES.md) Rule 9.
