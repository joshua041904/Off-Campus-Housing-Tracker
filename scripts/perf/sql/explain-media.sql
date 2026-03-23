-- media DB (5448)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, user_id, object_key, status, created_at
FROM media.media_files
ORDER BY created_at DESC
LIMIT 50;
