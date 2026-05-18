import type { Pool } from "pg";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Returns booking ids eligible for public peer-review feedback (same rule as peer review form). */
export async function peerReviewEligibleBookingIdSet(
  bookingReadPool: Pool,
  bookingIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(bookingIds.map((x) => String(x).trim()).filter((x) => UUID_RE.test(x)))];
  if (!ids.length) return new Set();
  const r = await bookingReadPool.query(
    `SELECT id::text AS id, status::text AS status
     FROM booking.bookings
     WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  const statusById = new Map<string, string>(
    (r.rows as { id: string; status: string }[]).map((row) => [String(row.id), String(row.status)]),
  );
  const ok = new Set<string>();
  for (const id of ids) {
    const st = statusById.get(id);
    if (st === undefined) {
      /** Booking row not visible from trust read path (replica lag, env mismatch, or historical delete) — still show stored reviews. */
      ok.add(id);
      continue;
    }
    const u = st.trim().toLowerCase();
    if (u === "pending_confirmation" || u === "confirmed" || u === "completed") ok.add(id);
  }
  return ok;
}

/** @deprecated use peerReviewEligibleBookingIdSet */
export const completedBookingIdSet = peerReviewEligibleBookingIdSet;

export function filterReviewRowsByPeerEligibleBookings<T extends { booking_id?: unknown }>(
  rows: T[],
  eligible: Set<string>,
): T[] {
  return rows.filter((row) => {
    const bid = row.booking_id != null ? String(row.booking_id) : "";
    return bid && eligible.has(bid);
  });
}

/** @deprecated use filterReviewRowsByPeerEligibleBookings */
export function filterReviewRowsByCompletedBookings<T extends { booking_id?: unknown }>(
  rows: T[],
  completed: Set<string>,
): T[] {
  return filterReviewRowsByPeerEligibleBookings(rows, completed);
}
