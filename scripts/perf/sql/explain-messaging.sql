-- messaging DB (5444)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, conversation_id, sender_id, body, created_at
FROM messaging.messages
WHERE deleted_at IS NULL
ORDER BY created_at DESC
LIMIT 50;

EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT conversation_id, user_id, joined_at
FROM messaging.conversation_participants
WHERE user_id = '00000000-0000-0000-0000-000000000001'::uuid
  AND deleted = false
LIMIT 50;
