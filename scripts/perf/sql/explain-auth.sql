-- auth DB (port 5441) — representative: lookup by email (auth-service)
EXPLAIN (ANALYZE, BUFFERS, VERBOSE)
SELECT id, email FROM auth.users WHERE email = '__explain_probe_nonexistent__@example.com' LIMIT 1;
