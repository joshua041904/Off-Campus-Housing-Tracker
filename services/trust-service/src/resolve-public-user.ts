import type { Pool } from "pg";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function escapeLike(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

export type PublicUserMatch = {
  id: string;
  username: string | null;
  display_name: string | null;
  /** Present only for exact UUID lookups (counterparty enrichment on authenticated surfaces). */
  email: string | null;
};

/**
 * Resolve @handle / username / display name to auth.users ids (public read; rate-limit at edge in prod).
 */
export async function resolvePublicUsersByHandle(
  pool: Pool,
  raw: string,
): Promise<PublicUserMatch[]> {
  const q = raw.trim();
  if (!q || q.length > 160) return [];

  if (UUID_RE.test(q)) {
    const r = await pool.query(
      `SELECT u.id::text AS id,
              NULLIF(TRIM(COALESCE(u.username::text, '')), '') AS username,
              NULLIF(TRIM(COALESCE(u.display_username::text, '')), '') AS display_name,
              NULLIF(TRIM(COALESCE(u.email::text, '')), '') AS email
       FROM auth.users u
       WHERE u.id = $1::uuid
         AND COALESCE(u.is_deleted, false) = false
         AND COALESCE(u.deletion_state, 'active') = 'active'
       LIMIT 5`,
      [q],
    );
    return (r.rows as PublicUserMatch[]).map((row) => ({
      id: String(row.id),
      username: row.username ?? null,
      display_name: row.display_name ?? null,
      email: row.email ?? null,
    }));
  }

  const needle = q.replace(/^@+/, "").trim();
  if (!needle) return [];

  const exact = needle.toLowerCase();
  const likePat = `%${escapeLike(needle)}%`;
  const useFuzzy = needle.length >= 2;

  const r = await pool.query(
    `SELECT u.id::text AS id,
            NULLIF(TRIM(COALESCE(u.username::text, '')), '') AS username,
            NULLIF(TRIM(COALESCE(u.display_username::text, '')), '') AS display_name
     FROM auth.users u
     WHERE COALESCE(u.is_deleted, false) = false
       AND COALESCE(u.deletion_state, 'active') = 'active'
       AND (
         lower(trim(COALESCE(u.username::text, ''))) = $1
         OR lower(trim(COALESCE(u.display_username::text, ''))) = $1
         OR ($3::boolean AND (
              COALESCE(u.username::text, '') ILIKE $2 ESCAPE '\\'
              OR COALESCE(u.display_username::text, '') ILIKE $2 ESCAPE '\\'
            ))
       )
     ORDER BY
       CASE WHEN lower(trim(COALESCE(u.username::text, ''))) = $1 THEN 0 ELSE 1 END,
       u.created_at DESC
     LIMIT 15`,
    [exact, likePat, useFuzzy],
  );
  return (r.rows as PublicUserMatch[]).map((row) => ({
    id: String(row.id),
    username: row.username ?? null,
    display_name: row.display_name ?? null,
    email: null,
  }));
}
