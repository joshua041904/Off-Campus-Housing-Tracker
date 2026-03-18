# Media service — full design

Production-grade but not overengineered. No file streaming via gRPC; signed URLs only. Strict TLS + mTLS; Kafka outbox discipline.

---

## Responsibilities

**Media service owns:**

- File uploads (images, videos, PDFs) via **signed URLs** (client uploads directly to object storage)
- Object storage (MinIO locally, S3 in prod)
- Media metadata DB (`media.media_files`)
- CreateUploadUrl, CompleteUpload, GetDownloadUrl
- Emits `media.uploaded` event (via outbox)
- Strict TLS + mTLS
- Kafka outbox discipline

**It does not:**

- Stream video through gRPC
- Deliver files via Kafka
- Store blobs in Postgres

---

## Proto (source of truth)

**proto/media.proto**

- **CreateUploadUrl(user_id, filename, content_type, size_bytes)** → media_id, upload_url, object_key, expires_at  
  - Generates media_id, object_key = `user_id/YYYY/MM/{uuid}`, inserts row with status = `pending`, returns presigned PUT URL (e.g. 5 min expiry).
- **CompleteUpload(media_id)** → success  
  - Verifies object exists in storage, updates status = `uploaded`, inserts outbox row (MediaUploadedV1), commits.
- **GetDownloadUrl(media_id)** → download_url, expires_at  
  - Returns presigned GET URL (short-lived).

No file bytes over gRPC. Client uploads directly to MinIO/S3 using the presigned URL.

---

## DB schema

**infra/db/01-media-schema.sql**

- **media.media_files:** id (UUID, = media_id), user_id, object_key, filename, content_type, size_bytes, status (`pending` | `uploaded` | `failed`), created_at, updated_at.
- **infra/db/02-media-outbox.sql:** media.outbox_events (same contract as other outboxes; aggregate_id = media_id for Kafka key).

---

## Signed URL flow (correct way)

**Upload**

1. Client calls **CreateUploadUrl**.
2. Media service: generates media_id; generates object_key `user_id/YYYY/MM/{uuid}`; saves DB row status = `pending`; generates presigned PUT URL (e.g. 5 min expiry); returns media_id, upload_url, object_key, expires_at.
3. **Client uploads directly to MinIO/S3** using the URL (no file touches the gRPC server).
4. Client calls **CompleteUpload(media_id)**.
5. Media service: verifies object exists in storage; updates status = `uploaded`; inserts outbox row (MediaUploadedV1); commits. Publisher loop produces to `${ENV_PREFIX}.media.events`.

**Download**

- Client calls **GetDownloadUrl(media_id)** → service returns presigned GET URL.

---

## MinIO setup (Colima / local dev)

**docker-compose.yml** (added):

- Service **minio**: image `minio/minio`, command `server /data --console-address ":9001"`, env MINIO_ROOT_USER, MINIO_ROOT_PASSWORD, ports 9000 (API), 9001 (console), volume minio_data.

**Create bucket on startup** (once MinIO is up):

```bash
# Install mc (MinIO Client) if needed: brew install minio/stable/mc
mc alias set local http://localhost:9000 minio minio123
mc mb local/housing-media --ignore-existing
```

**Media service config (env):**

- `S3_ENDPOINT=http://minio:9000` (or http://localhost:9000 from host)
- `S3_BUCKET=housing-media`
- `S3_ACCESS_KEY=minio`
- `S3_SECRET_KEY=minio123`
- `S3_USE_SSL=false` for local MinIO (true for prod S3)

In k3s: deploy MinIO as StatefulSet or use external MinIO; same env pattern.

---

## Event

**MediaUploadedV1** (proto/events/media.proto): media_id, user_id, content_type, uploaded_at. Emitted only after CompleteUpload (status = uploaded). No bytes in event. Topic: `${ENV_PREFIX}.media.events`, Kafka key = media_id.

---

## Health

- DB (media) down → NOT_SERVING.
- Storage (MinIO/S3) unreachable → NOT_SERVING or SERVING degraded (choose intentionally).
- Kafka down → if events required for correctness, NOT_SERVING; else degraded.

---

## What NOT to do

- Do not stream file bytes through gRPC.
- Do not put media bytes in Kafka.
- Do not store blobs in Postgres.

Refs: [MESSAGING_KAFKA_ARCHITECTURE.md](MESSAGING_KAFKA_ARCHITECTURE.md), [OUTBOX_PUBLISHER_IMPLEMENTATION.md](OUTBOX_PUBLISHER_IMPLEMENTATION.md).
