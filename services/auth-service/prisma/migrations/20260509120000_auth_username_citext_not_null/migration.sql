-- Canonical username (case-insensitive uniqueness via CITEXT).
CREATE EXTENSION IF NOT EXISTS citext;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS username CITEXT;

WITH base AS (
  SELECT id,
         LOWER(
           REGEXP_REPLACE(
             COALESCE(NULLIF(TRIM(display_username::text), ''), SPLIT_PART(COALESCE(email::text, ''), '@', 1), 'user'),
             '[^a-zA-Z0-9_]+',
             '_',
             'g'
           )
         ) AS candidate
  FROM auth.users
),
ranked AS (
  SELECT b.id,
         CASE
           WHEN ROW_NUMBER() OVER (PARTITION BY b.candidate ORDER BY b.id) = 1
             THEN b.candidate
             ELSE CONCAT(b.candidate, '_', SUBSTRING(REPLACE(b.id::text, '-', '') FROM 1 FOR 8))
         END AS final_username
  FROM base b
)
UPDATE auth.users u
SET username = ranked.final_username::citext
FROM ranked
WHERE u.id = ranked.id
  AND (u.username IS NULL OR TRIM(u.username::text) = '');

UPDATE auth.users
SET display_username = username::text
WHERE display_username IS NULL OR TRIM(display_username) = '';

ALTER TABLE auth.users ALTER COLUMN username SET NOT NULL;

DROP INDEX IF EXISTS idx_auth_users_display_username_unique;

CREATE UNIQUE INDEX IF NOT EXISTS auth_users_username_key ON auth.users (username);
