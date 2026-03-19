# messaging-service

Owns: conversations, messages, per-user read state. DB: `messaging`. No booking/listing logic in this DB; call booking/listing via gRPC if needed.

**Architecture:** Domain-isolated; cross-domain only via Kafka events. **Kafka is the event backbone, not chat transport.** Messaging does not consume its own topic. See [docs/MESSAGING_KAFKA_ARCHITECTURE.md](../../docs/MESSAGING_KAFKA_ARCHITECTURE.md), root [README.md](../../README.md), and [ARCHITECTURE_RULES.md](../../ARCHITECTURE_RULES.md).

---

## RPC contract (proto)

**Source of truth:** [proto/messaging.proto](../../proto/messaging.proto).

- **SendMessage** — Insert message in DB + outbox row (MessageSentV1); commit; publisher loop produces to Kafka. Do NOT produce directly in the handler.
- **GetConversation** — Cursor-based pagination: `limit` + `before` (message_id, exclusive). Returns `messages` + `has_more`. No single `read` flag on Message; read state is per-user (see MarkAsRead).
- **MarkAsRead** — Updates per-user read position: `conversation_participants.last_read_at` for (conversation_id, user_id). Optional `message_id` = “read up to this message” (set last_read_at to that message’s created_at). Read logic is local; do NOT use Kafka to drive read receipts.

**gRPC + health:** Implement [proto/health.proto](../../proto/health.proto) for probes. If new to gRPC, see [auth-service README](../auth-service/README.md#implementing-this-service-grpc).

---

## DB alignment

- **Schema:** [infra/db/01-messaging-schema.sql](../../infra/db/01-messaging-schema.sql) — `conversations`, `conversation_participants` (with `last_read_at`), `messages`.
- **Proto `content`** maps to DB column **`body`**.
- **Read state:** No `read` on Message. Unread = messages with `created_at > participant.last_read_at` and `sender_id != current user`. MarkAsRead updates `conversation_participants.last_read_at`.

---

## Outbox (SendMessage)

1. Insert row into `messaging.messages`.
2. Insert row into `messaging.outbox_events` with serialized **MessageSentV1** (message_id, conversation_id, sender_id, recipient_id, sent_at — no content). Set **aggregate_id = conversation_id** so the publisher uses Kafka key = conversation_id (ordering per conversation).
3. Commit the transaction.
4. Background publisher loop (see [docs/OUTBOX_PUBLISHER_IMPLEMENTATION.md](../../docs/OUTBOX_PUBLISHER_IMPLEMENTATION.md)) drains outbox: produce → UPDATE published = true → commit. Never produce inside the SendMessage handler.

Outbox table: [infra/db/02-messaging-outbox.sql](../../infra/db/02-messaging-outbox.sql).

---

## Strict TLS + mTLS

**gRPC server (in-cluster):** Use server TLS (e.g. `messaging-service.crt`, `messaging-service.key`, signed by cluster CA). Mount via Secret; e.g. volumeMount path `/certs`.

**Kafka (common):** Use [services/common/src/kafka.ts](../common/src/kafka.ts). No bypass. Strict TLS/mTLS: when `KAFKA_SSL_ENABLED=true`, CA + client cert + key are **required** (no plaintext fallback).

- Set `KAFKA_SSL_ENABLED=true` for TLS (port 9093). Broker uses `ssl.client.auth=required` (mTLS).
- Certificates: pass **file paths** via env so K8s can mount secrets. The base deploy mounts **kafka-ssl-secret** at `/etc/kafka/secrets` with `ca-cert.pem`, `client.crt`, `client.key`.
  - `KAFKA_CA_CERT` — path to CA (e.g. `/etc/kafka/secrets/ca-cert.pem`)
  - `KAFKA_CLIENT_CERT` — path to client cert (e.g. `/etc/kafka/secrets/client.crt`)
  - `KAFKA_CLIENT_KEY` — path to client key (e.g. `/etc/kafka/secrets/client.key`)
- Create/update **kafka-ssl-secret** (including client cert) with: `./scripts/kafka-ssl-from-dev-root.sh` (requires `certs/dev-root.pem` and `certs/dev-root.key`).

---

## Health

- **DB down** → NOT_SERVING.
- **Kafka down** — choose one:
  - Events required for correctness (e.g. notifications depend on MessageSent) → NOT_SERVING.
  - Messaging works without events (analytics only) → SERVING, degraded (e.g. log “Kafka unreachable”).
- Use `checkKafkaConnectivity()` from `@common/utils/kafka` and combine with DB ping in the health check passed to `registerHealthService`.

---

## What NOT to add

Do not add:

- Streaming RPC (yet)
- WebSocket
- Kafka-based message delivery to clients
- Extra message-ordering layer
- Redis pub/sub for chat

Keep the design boring and aligned with the DB + outbox + event backbone.

---

## Events (proto/events)

- **MessageSentV1** — Emitted via outbox on SendMessage. No content in event; analytics-friendly.
- **MessageReadV1** — Optional; emit only for analytics/engagement. Never use Kafka to drive read receipts; keep read logic local.

See [proto/events/messaging.proto](../../proto/events/messaging.proto) and [docs/EVENT_LAYER_STABILITY.md](../../docs/EVENT_LAYER_STABILITY.md).

---

## Build / run

Use `services/common` (Kafka, gRPC, logger, metrics). Add package.json, tsconfig.json, Dockerfile (multi-stage; build common first). Expose gRPC and optionally `/health`, `/metrics` for HTTP. Deploy in Colima with TLS mounts; load-test locally once wiring is in place.
