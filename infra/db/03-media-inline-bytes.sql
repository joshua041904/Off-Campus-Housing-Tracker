-- Optional inline storage for media when S3/MinIO credentials are unavailable (dev/test).
-- Bytes live in Postgres; public delivery uses signed GET /public/:id on media-service.

ALTER TABLE media.media_files
  ADD COLUMN IF NOT EXISTS inline_bytes BYTEA;

COMMENT ON COLUMN media.media_files.inline_bytes IS 'When object_key starts with inline/, file bytes stored here instead of S3.';
