-- Add media_id to messaging.messages for messages that reference an attachment (Media service stores bytes).
-- Run after 01-messaging-schema.sql and 02-messaging-outbox.sql.
-- See docs/MESSAGING_KAFKA_ARCHITECTURE.md: no media bytes in Postgres/Kafka/gRPC; messaging stores only reference.

ALTER TABLE messaging.messages ADD COLUMN IF NOT EXISTS media_id TEXT;

COMMENT ON COLUMN messaging.messages.media_id IS 'Optional reference to media service object; media bytes stored in object storage (MinIO/S3), not here.';
