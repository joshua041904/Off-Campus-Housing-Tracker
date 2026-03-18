# media-service

Handles file uploads (images, videos, PDFs) via **signed URLs only**. No file bytes over gRPC; client uploads directly to object storage (MinIO locally, S3 in prod). Media service owns metadata DB and emits `media.uploaded` via outbox.

**Architecture:** See [docs/MEDIA_SERVICE_DESIGN.md](../../docs/MEDIA_SERVICE_DESIGN.md) and [docs/MESSAGING_KAFKA_ARCHITECTURE.md](../../docs/MESSAGING_KAFKA_ARCHITECTURE.md). Messaging stores `media_id`; this service owns CreateUploadUrl, CompleteUpload, GetDownloadUrl.

---

## RPC contract (proto)

**Source of truth:** [proto/media.proto](../../proto/media.proto).

- **CreateUploadUrl(user_id, filename, content_type, size_bytes)** → media_id, upload_url, object_key, expires_at.  
  Inserts row status = `pending`; returns presigned PUT URL. Client uploads directly to MinIO/S3.
- **CompleteUpload(media_id)** → success.  
  Verifies object exists; sets status = `uploaded`; inserts outbox row (MediaUploadedV1); commits. Publisher produces to `${ENV_PREFIX}.media.events`.
- **GetDownloadUrl(media_id)** → download_url, expires_at.  
  Returns presigned GET URL.

No file streaming via gRPC.

---

## DB and storage

- **Schema:** [infra/db/01-media-schema.sql](../../infra/db/01-media-schema.sql) — `media.media_files` (id, user_id, object_key, filename, content_type, size_bytes, status, created_at, updated_at). Status: `pending` | `uploaded` | `failed`.
- **Outbox:** [infra/db/02-media-outbox.sql](../../infra/db/02-media-outbox.sql). After CompleteUpload, insert MediaUploadedV1; publisher loop produces with key = media_id.
- **Object storage:** MinIO (dev; see docker-compose minio service); S3 (prod). Env: S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY. Create bucket `housing-media` on first run (e.g. `mc mb local/housing-media`).

---

## MinIO (local dev)

- docker-compose includes **minio** (ports 9000, 9001). Create bucket: `mc alias set local http://localhost:9000 minio minio123` then `mc mb local/housing-media --ignore-existing`.
- Media service env: S3_ENDPOINT=http://minio:9000, S3_BUCKET=housing-media, S3_ACCESS_KEY=minio, S3_SECRET_KEY=minio123.

---

## What NOT to do

- Do not stream file bytes through gRPC.
- Do not put media bytes in Kafka or Postgres.

---

## Observability

- `uploads_total`, `upload_failures`, `upload_bytes_total` (Prometheus).

---

## Build / run

Use `services/common`. Add package.json, tsconfig.json, Dockerfile. TLS for gRPC; health check (DB + storage; optional Kafka if outbox wired). For Colima/k3s, deploy MinIO as StatefulSet or use external endpoint.
