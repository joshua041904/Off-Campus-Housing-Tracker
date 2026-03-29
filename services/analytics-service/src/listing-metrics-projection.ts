/**
 * Idempotent projection: ListingCreated → analytics.daily_metrics.new_listings.
 * Shared by Kafka consumer and HTTP internal ingest (ANALYTICS_SYNC_MODE).
 */
import type { Pool } from "pg";

export async function tryClaimListingEvent(pool: Pool, eventId: string): Promise<boolean> {
  try {
    const ins = await pool.query(
      `INSERT INTO analytics.processed_events (event_id) VALUES ($1::uuid) ON CONFLICT (event_id) DO NOTHING`,
      [eventId]
    );
    return (ins.rowCount ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function bumpDailyMetricsNewListings(pool: Pool, dayYmd: string): Promise<void> {
  await pool.query(
    `INSERT INTO analytics.daily_metrics (date, new_listings)
     VALUES ($1::date, 1)
     ON CONFLICT (date) DO UPDATE SET
       new_listings = analytics.daily_metrics.new_listings + 1,
       updated_at = now()`,
    [dayYmd]
  );
}

/** Claim event_id then increment new_listings for listed_at_day. Returns true if this call applied the bump. */
export async function applyListingCreatedForAnalytics(
  pool: Pool,
  eventId: string,
  listedAtDay: string
): Promise<boolean> {
  const day = String(listedAtDay || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  if (!/^[0-9a-f-]{36}$/i.test(String(eventId || "").trim())) return false;
  const claimed = await tryClaimListingEvent(pool, String(eventId).trim());
  if (!claimed) return false;
  await bumpDailyMetricsNewListings(pool, day);
  return true;
}
