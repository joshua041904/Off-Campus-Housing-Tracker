import type { PoolClient } from "pg";

/**
 * Append a revision row after a side effect (e.g. media attach/delete/reorder).
 * `snapshot` is the current listings.listings row as JSON (audit anchor); `changes` holds human-facing deltas.
 */
export async function insertListingRevisionEntry(
  client: PoolClient,
  listingId: string,
  editorUserId: string,
  changes: Record<string, unknown>,
): Promise<void> {
  const snap = await client.query(
    `SELECT row_to_json(s)::jsonb AS snapshot FROM (SELECT * FROM listings.listings WHERE id = $1::uuid) s`,
    [listingId],
  );
  const snapshot = snap.rows[0]?.snapshot;
  if (!snapshot) return;
  try {
    await client.query(
      `INSERT INTO listings.listing_revisions (listing_id, editor_user_id, snapshot, changes)
       VALUES ($1::uuid, $2::uuid, $3::jsonb, $4::jsonb)`,
      [listingId, editorUserId, snapshot, JSON.stringify(changes)],
    );
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === "42703") {
      await client.query(
        `INSERT INTO listings.listing_revisions (listing_id, editor_user_id, snapshot)
         VALUES ($1::uuid, $2::uuid, $3::jsonb)`,
        [listingId, editorUserId, snapshot],
      );
    } else {
      throw e;
    }
  }
}
