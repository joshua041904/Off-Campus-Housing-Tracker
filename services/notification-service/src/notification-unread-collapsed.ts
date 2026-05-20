import type { Pool } from "pg";
import { countBookingContextUnreadRows } from "./notification-list-booking-read.js";
import { syncBookingContextReadStateForUser } from "./sync-booking-context-read.js";
import { surfaceWhereClause, type NotificationAudienceScope } from "./notification-visibility.js";

/** Unread bell count: one per booking context with no read rows (after DB sibling sync). */
export async function countCollapsedUnreadNotifications(
  pool: Pool,
  userId: string,
  scope: NotificationAudienceScope,
): Promise<number> {
  await syncBookingContextReadStateForUser(pool, userId);
  const where = `${surfaceWhereClause(scope, "n")}`;
  const r = await pool.query(
    `SELECT n.id, n.event_type, n.payload, n.created_at, n.read_at, n.dedupe_key
     FROM notification.notifications n
     WHERE ${where}`,
    [userId],
  );
  return countBookingContextUnreadRows(r.rows as Record<string, unknown>[]);
}
