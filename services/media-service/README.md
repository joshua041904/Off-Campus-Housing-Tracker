# media-service

Handles file/video upload and download via **signed URLs**. No media bytes in Postgres or Kafka; storage in object storage (MinIO for Colima dev, S3 for prod).

**Architecture:** See [docs/MESSAGING_KAFKA_ARCHITECTURE.md](../../docs/MESSAGING_KAFKA_ARCHITECTURE.md). Messaging stores `media_id`; this service owns upload, storage, and presigned URL generation. Emits `MediaUploadedV1` to `${ENV_PREFIX}.media.events` via outbox (when outbox is wired).

---

## RPC contract (proto)

**Source of truth:** [proto/media.proto](../../proto/media.proto).

- **UploadFile** — Stream or chunked upload; validate file type/size; store in object storage; return `media_id`.
- **GeneratePresignedUploadURL** — Return a short-lived URL for client-side upload; reserve `media_id`.
- **GeneratePresignedDownloadURL** — Return a short-lived URL for client to download by `media_id`.

---

## Responsibilities

- Upload (stream or chunked)
- Generate presigned upload URL
- Generate presigned download URL
- Validate file type (and size)
- Virus scan (future)
- Emit `media.uploaded` event (outbox when implemented)

**Storage:** MinIO (local/Colima), S3 (prod), GCS (optional).

---

## What NOT to do

- Do **not** store video/media bytes in Postgres.
- Do **not** stream media bytes through gRPC beyond chunked upload to this service.
- Do **not** put media bytes in Kafka events.

---

## Observability

Expose Prometheus metrics (e.g. prom-client):

- `uploads_total`
- `upload_failures`
- `upload_bytes_total`

---

## Build / run

Use `services/common`. Add package.json, tsconfig.json, Dockerfile. TLS for gRPC; health check (storage + optional Kafka if emitting events). For Colima dev, use MinIO in bring-up or docker-compose.
