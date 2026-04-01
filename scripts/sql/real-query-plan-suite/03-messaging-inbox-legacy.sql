-- Messaging DB (5444): HTTP service inbox pattern (messages.*). Skip errors if schema absent.
\set ON_ERROR_STOP off
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT id, subject, content, created_at, is_read
FROM messages.messages
WHERE recipient_id = '00000000-0000-0000-0000-000000000002'::uuid
ORDER BY created_at DESC
LIMIT 50;
