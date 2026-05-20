-- Auth profile fields for user-facing identity in messaging/search UI.
-- Apply with:
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5441 -U postgres -d auth -f infra/db/02-auth-user-profile-fields.sql

CREATE SCHEMA IF NOT EXISTS auth;

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(128),
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS display_username VARCHAR(128);

-- Backfill stable username from email prefix, then suffix with user-id chunk on collision.
WITH base AS (
  SELECT id,
         LOWER(
           REGEXP_REPLACE(
             COALESCE(NULLIF(TRIM(display_username), ''), SPLIT_PART(COALESCE(email, ''), '@', 1), 'user'),
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
           ELSE CONCAT(b.candidate, '_', SUBSTRING(REPLACE(b.id::text, '-', '') FROM 1 FOR 6))
         END AS username
  FROM base b
)
UPDATE auth.users u
SET display_username = r.username
FROM ranked r
WHERE u.id = r.id
  AND (u.display_username IS NULL OR TRIM(u.display_username) = '');

CREATE UNIQUE INDEX IF NOT EXISTS idx_auth_users_display_username_unique
  ON auth.users (LOWER(display_username))
  WHERE display_username IS NOT NULL;
