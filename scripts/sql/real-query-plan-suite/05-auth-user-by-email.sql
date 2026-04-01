-- Auth DB (5441): login path (email lookup). Uses whatever unique btree exists on users.
\set ON_ERROR_STOP on
EXPLAIN (ANALYZE, BUFFERS, VERBOSE, FORMAT TEXT)
SELECT id, email, created_at
FROM auth.users
WHERE email = 'nonexistent-probe@example.invalid'
LIMIT 1;
