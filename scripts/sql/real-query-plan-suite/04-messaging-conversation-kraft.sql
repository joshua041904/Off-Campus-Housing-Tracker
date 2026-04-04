-- Messaging DB (5444): KRaft-style conversation timeline (messaging.*).
\set ON_ERROR_STOP off
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT id, sender_id, body, created_at
FROM messaging.messages
WHERE conversation_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 50;
