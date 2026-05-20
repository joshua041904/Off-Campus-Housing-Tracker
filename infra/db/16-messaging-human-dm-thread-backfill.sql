-- Backfill stable human DM thread_id values so inbox groups one row per peer pair.
-- Algorithm must match services/messaging-service/src/lib/dm-thread-id.ts (UUID v5).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

UPDATE messages.messages m
SET thread_id = uuid_generate_v5(
  '0cb1ee80-bfcd-4fb7-90c0-64e2c2dd3d1f'::uuid,
  'dm:' ||
  CASE
    WHEN m.sender_id::text < m.recipient_id::text THEN m.sender_id::text
    ELSE m.recipient_id::text
  END ||
  ':' ||
  CASE
    WHEN m.sender_id::text < m.recipient_id::text THEN m.recipient_id::text
    ELSE m.sender_id::text
  END
)
WHERE m.group_id IS NULL
  AND m.recipient_id IS NOT NULL
  AND m.thread_id IS NULL
  AND COALESCE(m.message_type, '') NOT IN ('BookingNotice', 'booking_notice', 'SYSTEM', 'System')
  AND NOT (COALESCE(lower(m.content), '') LIKE 'booking request created for listing%');
