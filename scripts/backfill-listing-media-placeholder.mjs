#!/usr/bin/env node
/**
 * Dev/CI helper: insert one placeholder image URL per listing that has no listing_media row.
 * Does not delete or modify existing media.
 */
import pg from "pg";

const { Client } = pg;
const conn = process.env.POSTGRES_URL_LISTINGS || "postgresql://postgres:postgres@127.0.0.1:5442/listings";

const client = new Client({ connectionString: conn });

async function main() {
  await client.connect();
  const r = await client.query(`
    INSERT INTO listings.listing_media (listing_id, media_type, url_or_path, sort_order)
    SELECT l.id,
           'image',
           'https://picsum.photos/seed/' || replace(l.id::text, '-', '') || '/1200/800',
           0
    FROM listings.listings l
    WHERE l.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM listings.listing_media m WHERE m.listing_id = l.id)
    RETURNING listing_id
  `);
  console.log(JSON.stringify({ ok: true, insertedRows: r.rowCount, listingIds: r.rows.map((x) => x.listing_id) }, null, 2));
  await client.end();
}

main().catch(async (e) => {
  console.error(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  try {
    await client.end();
  } catch {}
  process.exit(1);
});
