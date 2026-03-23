-- notification DB (5445)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, user_id, event_type, status, created_at
FROM notification.notifications
ORDER BY created_at DESC
LIMIT 50;
