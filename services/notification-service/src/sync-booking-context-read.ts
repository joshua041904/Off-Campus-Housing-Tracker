import type { Pool } from "pg";
import {
  BOOKING_ID_FROM_ROW_N_SQL,
  IS_BOOKING_NOTIFICATION_ROW_N_SQL,
} from "./booking-context-sql.js";

/** Persist read_at to every sibling row when any row in the booking context was read. */
export async function syncBookingContextReadStateForUser(
  pool: Pool,
  userId: string,
): Promise<{ updated: number }> {
  const r = await pool.query<{ id: string }>(
    `
    WITH booking_rows AS (
      SELECT
        n.id,
        n.user_id,
        ${BOOKING_ID_FROM_ROW_N_SQL} AS booking_ctx,
        n.read_at
      FROM notification.notifications n
      WHERE n.user_id = $1::uuid
        AND ${IS_BOOKING_NOTIFICATION_ROW_N_SQL}
    ),
    ctx AS (
      SELECT
        user_id,
        booking_ctx,
        MIN(read_at) AS context_read_at
      FROM booking_rows
      WHERE booking_ctx ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      GROUP BY user_id, booking_ctx
      HAVING BOOL_OR(read_at IS NOT NULL)
    ),
    touched AS (
      UPDATE notification.notifications n
      SET read_at = COALESCE(n.read_at, c.context_read_at)
      FROM booking_rows br
      JOIN ctx c
        ON br.user_id = c.user_id
       AND br.booking_ctx = c.booking_ctx
      WHERE n.id = br.id
        AND n.read_at IS NULL
        AND c.context_read_at IS NOT NULL
      RETURNING n.id
    )
    SELECT id FROM touched
    `,
    [userId],
  );
  return { updated: r.rowCount ?? r.rows.length };
}
