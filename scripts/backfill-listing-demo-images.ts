#!/usr/bin/env npx tsx
/**
 * Attach local demo SVG paths to listings with missing/placeholder images (idempotent).
 *
 * Usage:
 *   PGPASSWORD=postgres npx tsx scripts/backfill-listing-demo-images.ts
 *   DRY_RUN=1 npx tsx scripts/backfill-listing-demo-images.ts
 */

import pg from "pg";

const PGHOST = process.env.PGHOST || "127.0.0.1";
const PGPORT = Number(process.env.LISTINGS_DB_PORT || "5442");
const DRY_RUN = process.env.DRY_RUN === "1";

const DEMO_IMAGES = [
  "/demo-listings/apartment-1.svg",
  "/demo-listings/apartment-2.svg",
  "/demo-listings/studio-1.svg",
  "/demo-listings/house-1.svg",
];

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

async function main(): Promise<void> {
  const pool = new pg.Pool({
    host: PGHOST,
    port: PGPORT,
    user: "postgres",
    password: process.env.PGPASSWORD || "postgres",
    database: "listings",
  });
  try {
    const r = await pool.query<{ listing_id: string }>(
      `SELECT l.id::text AS listing_id
       FROM listings.listings l
       WHERE l.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM listings.listing_media m
           WHERE m.listing_id = l.id AND m.media_type = 'image'
         )
       ORDER BY l.created_at DESC
       LIMIT 500`,
    );
    let inserted = 0;
    for (const row of r.rows) {
      const url = DEMO_IMAGES[hashId(row.listing_id) % DEMO_IMAGES.length]!;
      if (DRY_RUN) {
        console.log(`would attach ${url} -> ${row.listing_id}`);
        continue;
      }
      await pool.query(
        `INSERT INTO listings.listing_media (listing_id, media_type, url_or_path, sort_order)
         SELECT $1::uuid, 'image', $2, 0
         WHERE NOT EXISTS (
           SELECT 1 FROM listings.listing_media m
           WHERE m.listing_id = $1::uuid AND m.media_type = 'image'
         )`,
        [row.listing_id, url],
      );
      inserted += 1;
    }
    console.log(`Done: ${DRY_RUN ? "dry-run" : "inserted"} ${DRY_RUN ? r.rows.length : inserted} listing images`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
