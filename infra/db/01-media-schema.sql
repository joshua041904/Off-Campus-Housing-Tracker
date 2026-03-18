-- Media service DB: metadata for uploaded files. Blobs live in object storage (MinIO/S3).
-- Run against database 'media' on port 5448 (add to docker-compose / setup-all-dbs if needed):
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5448 -U postgres -d media -f infra/db/01-media-schema.sql
--
-- Messaging (and others) reference media_id. Media service owns upload, storage, signed URLs; emits media.uploaded via outbox.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS media;

CREATE TABLE media.media_files (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  object_key  TEXT NOT NULL,
  filename    TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes  BIGINT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'uploaded', 'failed')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_media_user_id ON media.media_files(user_id);
CREATE INDEX idx_media_status ON media.media_files(status);

COMMENT ON TABLE media.media_files IS 'Metadata only; file bytes in object storage. status: pending (presigned URL issued), uploaded (CompleteUpload verified), failed.';

CREATE OR REPLACE FUNCTION media.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_media_files_updated ON media.media_files;
CREATE TRIGGER tr_media_files_updated
  BEFORE UPDATE ON media.media_files
  FOR EACH ROW EXECUTE PROCEDURE media.set_updated_at();
