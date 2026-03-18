# Master implementation directive (make-it-real phase)

**Lock:** Strict TLS everywhere; mTLS everywhere; fully testable locally (no k3s); deterministic integration tests; Redis + MinIO + Postgres + Kafka (strict TLS) via docker-compose. No architectural drift.

**Do not:** Modify architecture; add new layers; streaming RPC; Kafka transactions; WebSockets; REST fallback.

---

## 1. Local dev stack (no k3s)

- **docker-compose.local.yml** — Postgres (media, messaging), Kafka (TLS), Zookeeper, Redis, MinIO; schema auto-apply (mounted SQL or init); cert volume mount. All services on one network.
- **scripts/dev-generate-certs.sh** — Create dev-root.pem (CA); leaf certs for messaging-service, media-service, kafka (broker + client); output under ./certs/. No plaintext Kafka.

**Strict TLS (local dev):** Dev CA + service certs; mTLS between messaging-service ↔ Kafka, media-service ↔ Kafka; gRPC server requires client cert. Optional: messaging ↔ Redis TLS, messaging ↔ Postgres TLS.

---

## 2. Media service implementation

- **Stack:** Node 20, TypeScript, @grpc/grpc-js, AWS SDK v3 (S3Client), MinIO via env, Kafka via common, outbox discipline.
- **Layout:** services/media-service/src/{ server.ts, grpc-server.ts, handlers/{ createUploadUrl.ts, completeUpload.ts, getDownloadUrl.ts }, storage/s3.ts, db/mediaRepo.ts, outbox/insertOutbox.ts, health.ts }, test/.
- **Tests (Vitest):** Unit: presigned PUT URL, object key user/YYYY/MM/uuid, reject invalid file types/size. Integration (compose up): CreateUploadUrl → pending row; CompleteUpload → uploaded; outbox row; publisher sets published=true.

---

## 3. Messaging service hardening

- **Rate limit:** services/messaging-service/src/rateLimit.ts — Redis key rate:msg:{user_id}, 30/min, 500/day; gRPC error when exceeded. Redis down → fail safe (block or degrade).
- **Spam:** On SendMessage call TrustService CheckUserSuspended RPC; reject if suspended. No DB sharing; RPC only.

---

## 4. Outbox publisher

- Background loop; poll every 1s; batch size configurable; order: produce → await success → UPDATE published=true → commit. On failure leave row, retry next loop.
- **Integration tests:** Reuse event-layer-verification patterns: crash after produce; crash after update before commit; Kafka down; verify behavior.

---

## 5. Kafka strict TLS (common)

- services/common/src/kafka.ts: Require SSL; reject if cert paths missing. Use KAFKA_SSL_CA_PATH, KAFKA_SSL_CERT_PATH, KAFKA_SSL_KEY_PATH. No plaintext fallback. Test: missing cert → startup fails.

---

## 6. gRPC strict mTLS

- grpc-server (media + messaging): createSsl(), require client cert, reject non-mTLS. Test: client without cert fails; client with cert succeeds.

---

## 7. MinIO integration

- Media: connect to MinIO; verify bucket exists; health fails if bucket missing. Health: DB + Kafka + S3.

---

## 8. Analytics stub consumer

- analytics-service/src/consumers/messagingConsumer.ts — On MessageSentV1 increment user_listing_engagement.messages_sent. Test: duplicate → processed once; ordering per conversation.

---

## 9. CI

- Spin docker-compose.local; run integration tests; tear down. Fail if TLS not enforced or plaintext Kafka detected.

---

## Critical discipline (must NOT)

- Kafka transactions, streaming RPC, WebSocket, Redis pub/sub for chat, Kafka for chat delivery, media in Postgres, media via gRPC streaming, REST fallback, new event topics.

---

## Verification checklist before freeze

- Media upload works locally; messaging rate limiting works; spam rejection works; Kafka TLS enforced; gRPC mTLS enforced; outbox break tests pass; duplicate event consumed once; health fails when Kafka down; health fails when S3 down. Then freeze event layer.

Refs: EVENT_LAYER_STABILITY.md, MEDIA_SERVICE_DESIGN.md, MESSAGING_RATE_LIMIT_AND_SPAM.md, ARCHITECTURE_OVERVIEW.md.
