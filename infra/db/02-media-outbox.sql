-- Transactional outbox for media-service. Run after 01-media-schema.sql.
-- Flow: CompleteUpload verifies object → UPDATE status = uploaded → insert outbox row (MediaUploadedV1) → commit; publisher produces to Kafka.

CREATE TABLE IF NOT EXISTS media.outbox_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_id  TEXT NOT NULL,
  type          TEXT NOT NULL,
  version       INT NOT NULL,
  payload       BYTEA NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  published     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_media_outbox_unpublished
  ON media.outbox_events(published, created_at)
  WHERE published = false;

COMMENT ON TABLE media.outbox_events IS 'Outbox: after upload verified, insert MediaUploadedV1; publisher sends EventEnvelope to ${ENV_PREFIX}.media.events; key = aggregate_id (media_id).';
