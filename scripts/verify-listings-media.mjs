#!/usr/bin/env node
import pg from "pg";

const { Client } = pg;
const conn = process.env.POSTGRES_URL_LISTINGS || "postgresql://postgres:postgres@127.0.0.1:5442/listings";

const client = new Client({ connectionString: conn });

async function main() {
  await client.connect();
  const recentHoursRaw = process.env.VERIFY_LISTINGS_MEDIA_RECENT_HOURS?.trim();
  const recentHours =
    recentHoursRaw && recentHoursRaw.length > 0 ? Math.max(0, Number.parseInt(recentHoursRaw, 10) || 0) : null;
  const q = `
    SELECT l.id
    FROM listings.listings l
    LEFT JOIN listings.listing_media lm ON l.id = lm.listing_id
    WHERE l.deleted_at IS NULL AND lm.id IS NULL
    ${recentHours != null && recentHours > 0 ? `AND l.created_at >= now() - (interval '1 hour' * $1::int)` : ""}
    ORDER BY l.created_at DESC
    LIMIT 200
  `;
  const r =
    recentHours != null && recentHours > 0
      ? await client.query(q, [String(recentHours)])
      : await client.query(q);
  const missing = r.rows.map((x) => x.id);
  console.log(
    JSON.stringify(
      {
        ok: true,
        scope:
          recentHours != null && recentHours > 0
            ? `listings created in the last ${recentHours}h without media`
            : "all non-deleted listings without media",
        missingCount: missing.length,
        missingListingIds: missing,
      },
      null,
      2,
    ),
  );
  await client.end();
  process.exit(missing.length === 0 ? 0 : 2);
}

main().catch(async (e) => {
  console.error(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  try { await client.end(); } catch {}
  process.exit(1);
});
