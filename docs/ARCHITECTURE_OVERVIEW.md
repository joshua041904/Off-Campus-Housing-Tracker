# Architecture overview — production-grade snapshot

Single-page snapshot of the housing platform backbone. No distributed spaghetti; clear boundaries; event layer frozen after verification.

---

## Exactly-once (final statement)

The system guarantees:

- **No event loss** (outbox: produce → update published → commit; never mark published before produce)
- **Deterministic retry** (unpublished rows republished; same order)
- **Idempotent consumption** (processed_events; insert event_id before handle; on conflict skip)
- **Per-conversation ordering** (Kafka key = conversation_id for messaging)
- **No distributed transaction chaos** (no 2PC, no cross-service DB writes)
- **No dual writes** (single outbox write in same transaction as domain write)
- **No event before commit** (domain + outbox commit first; then publisher produces)

That is **effectively exactly-once processing effect**. Do not add Kafka EOS, idempotent producer, or saga orchestrators. Ref: [EVENT_LAYER_STABILITY.md](EVENT_LAYER_STABILITY.md), [MESSAGING_KAFKA_ARCHITECTURE.md](MESSAGING_KAFKA_ARCHITECTURE.md).

---

## Service map

| Service | Storage | Outbox | Kafka | Consumers (of others) |
|--------|---------|--------|-------|------------------------|
| **Messaging** | Postgres (messages, conversations) | Yes | Produce MessageSentV1 | None (does not consume its own topic) |
| **Media** | Postgres (metadata) + MinIO/S3 | Yes | Produce MediaUploadedV1 | None |
| **Notification** | Postgres | Optional | — | MessageSentV1, Booking*, etc. |
| **Analytics** | Postgres (read models) | — | — | All event topics |
| **Trust** | Postgres | Yes | Emit UserSuspended*, ListingFlagged*, etc. | MessageSentV1 (spam), BookingCompleted (reviews) |
| **Booking** | Postgres | Yes | Booking* events | — |
| **Listings** | Postgres | Yes | Listing* events | ListingFlagged |
| **Auth** | Postgres | Yes | User* events | — |

---

## Final architecture overview (canonical)

**Messaging Service**  
→ Postgres  
→ Outbox  
→ Kafka  
→ Analytics, Trust, Notification  

**Media Service**  
→ MinIO (dev) / S3 (prod)  
→ Postgres (metadata)  
→ Outbox  
→ Kafka  

**Discipline**

- Strict TLS
- mTLS everywhere (Kafka; in-cluster gRPC when configured)
- ENV_PREFIX discipline (topic names)
- Partition key discipline (entity_id; conversation_id for messaging.events)
- Health discipline (DB + Kafka + storage in health checks)
- Break-tested event spine (outbox ordering verified)

This is clean distributed architecture. No distributed spaghetti.

---

## Data flow (high level)

- **Messaging** → Postgres + Outbox → Kafka (MessageSentV1) → Analytics, Notification, Trust.
- **Media** → MinIO/S3 + Postgres metadata + Outbox → Kafka (MediaUploadedV1). Messaging references media_id only.
- **Strict TLS** everywhere; **mTLS** for Kafka (and in-cluster gRPC when configured).
- **ENV_PREFIX** for all topic names; **partition key** = entity_id (conversation_id for messaging.events).
- **Health:** DB + Kafka (and storage for Media) in health checks; NOT_SERVING when required deps down.

---

## gRPC + HTTP/3 layer

- **Externally:** Caddy — HTTP/3 enabled, TLS termination, proxy to gateway.
- **Internally:** mTLS between services; gRPC over HTTP/2 inside cluster; no streaming required.
- **Media upload** bypasses gRPC server (client uploads via signed URL to MinIO/S3).

---

## What is locked

- Event layer ordering (Rule 9, EVENT_LAYER_STABILITY.md).
- Outbox contract (produce → update → commit; aggregate_id = Kafka key).
- Idempotent consumers (processed_events).
- Messaging: synchronous gRPC; Kafka for fanout only; no consumer inside messaging.
- Media: signed URLs only; no file bytes in gRPC/Kafka/Postgres.
- Rate limiting: Redis (not Kafka).
- Spam: Trust consumes MessageSentV1; user_spam_score; UserSuspendedV1.
- Recommendation: Analytics read models from events; messaging is event source only.

---

## Next moves (implementation order)

1. Implement media-service scaffold (CreateUploadUrl, CompleteUpload, GetDownloadUrl; MinIO config; signed URL generation).
2. Implement messaging outbox publisher + rate limiting (Redis).
3. Implement Trust spam-scoring consumer (MessageSentV1 → user_spam_score; UserSuspendedV1).
4. Implement Analytics read model (user_listing_engagement from MessageSentV1 + booking + views).
5. Freeze event layer; then move to search and recommendation ranking.

Refs: [EVENT_LAYER_STABILITY.md](EVENT_LAYER_STABILITY.md), [MESSAGING_KAFKA_ARCHITECTURE.md](MESSAGING_KAFKA_ARCHITECTURE.md), [MEDIA_SERVICE_DESIGN.md](MEDIA_SERVICE_DESIGN.md), [MESSAGING_RATE_LIMIT_AND_SPAM.md](MESSAGING_RATE_LIMIT_AND_SPAM.md), [ARCHITECTURE_RULES.md](../ARCHITECTURE_RULES.md).
