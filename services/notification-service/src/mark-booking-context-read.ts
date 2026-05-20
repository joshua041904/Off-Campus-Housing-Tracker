import type { Pool } from "pg";
import {
  BOOKING_ID_FROM_ROW_N_SQL,
  UUID_PATTERN,
  bookingContextMatchForBookingSql,
  bookingContextSeedWhereSql,
} from "./booking-context-sql.js";
import { syncBookingContextReadStateForUser } from "./sync-booking-context-read.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MarkBookingContextReadInput = {
  userId: string;
  bookingId?: string;
  notificationId?: string;
};

export type MarkBookingContextReadResult = {
  booking_id: string | null;
  read_at: string | null;
  affected_rows: number;
  notification_ids: string[];
  updated: number;
};

function isUuid(value: string): boolean {
  return UUID_RE.test(String(value || "").trim().toLowerCase());
}

export async function markBookingContextRead(
  pool: Pool,
  input: MarkBookingContextReadInput,
): Promise<MarkBookingContextReadResult> {
  const userId = String(input.userId || "").trim().toLowerCase();
  const requestBookingId = String(input.bookingId || "").trim().toLowerCase();
  const notificationId = String(input.notificationId || "").trim().toLowerCase();

  const updated = await pool.query<{ id: string; booking_id_text: string; read_at: string }>(
    `
    WITH seed AS (
      SELECT
        n.id::text AS id,
        ${BOOKING_ID_FROM_ROW_N_SQL} AS booking_id_text,
        n.dedupe_key
      FROM notification.notifications n
      WHERE n.user_id = $1::uuid
        AND ${bookingContextSeedWhereSql("n")}
    ),
    canonical AS (
      SELECT LOWER($3::text) AS booking_id
      WHERE $3::text <> '' AND $3::text ~* ${UUID_PATTERN}
      UNION
      SELECT DISTINCT LOWER(s.booking_id_text) AS booking_id
      FROM seed s
      WHERE s.booking_id_text ~* ${UUID_PATTERN}
    ),
    seed_dedupe AS (
      SELECT DISTINCT LOWER(TRIM(s.dedupe_key)) AS dedupe_key
      FROM seed s
      WHERE COALESCE(s.dedupe_key, '') <> ''
    ),
    touched AS (
      UPDATE notification.notifications n
      SET read_at = COALESCE(n.read_at, NOW())
      FROM canonical c
      WHERE n.user_id = $1::uuid
        AND EXISTS (SELECT 1 FROM canonical)
        AND (
          ${bookingContextMatchForBookingSql("n", "c.booking_id")}
          OR EXISTS (
            SELECT 1 FROM seed_dedupe sd
            WHERE sd.dedupe_key = LOWER(TRIM(COALESCE(n.dedupe_key, '')))
          )
        )
      RETURNING n.id::text AS id, ${BOOKING_ID_FROM_ROW_N_SQL} AS booking_id_text, n.read_at
    )
    SELECT * FROM touched
    `,
    [userId, notificationId || "", requestBookingId || ""],
  );

  const canonicalBooking =
    updated.rows.map((row) => String(row.booking_id_text || "").toLowerCase()).find((id) => isUuid(id)) ||
    (isUuid(requestBookingId) ? requestBookingId : null);

  if (!updated.rows.length) {
    const seedCheck = await pool.query<{ booking_id_text: string | null; id: string }>(
      `
      SELECT n.id::text AS id, ${BOOKING_ID_FROM_ROW_N_SQL} AS booking_id_text
      FROM notification.notifications n
      WHERE n.user_id = $1::uuid
        AND ${bookingContextSeedWhereSql("n")}
      LIMIT 10
      `,
      [userId, notificationId || "", requestBookingId || ""],
    );
    console.warn("[notifications mark context read] update affected 0 rows", {
      userId,
      bookingId: requestBookingId || null,
      notificationId: notificationId || null,
      seed: seedCheck.rows,
    });
  }

  if (canonicalBooking) {
    await syncBookingContextReadStateForUser(pool, userId);
  }

  const allForBookingAfter = canonicalBooking
    ? await pool.query<{ id: string; read_at: string }>(
        `
        SELECT n.id::text AS id, n.read_at
        FROM notification.notifications n
        WHERE n.user_id = $1::uuid
          AND ${bookingContextMatchForBookingSql("n", "$2")}
        ORDER BY n.created_at DESC
        `,
        [userId, canonicalBooking],
      )
    : { rows: [] as { id: string; read_at: string }[] };

  const notificationIds = allForBookingAfter.rows.map((row) => String(row.id).toLowerCase());
  const readAt =
    allForBookingAfter.rows.map((row) => row.read_at).find(Boolean)?.toString() ??
    updated.rows[0]?.read_at?.toString() ??
    null;

  const unreadAfter = allForBookingAfter.rows.filter((row) => !row.read_at).map((row) => row.id);
  if (canonicalBooking && unreadAfter.length > 0) {
    console.warn("[notifications mark context read] unread rows remain after update", {
      userId,
      bookingId: canonicalBooking,
      unreadIds: unreadAfter,
      updatedCount: updated.rows.length,
    });
  }

  console.info("[notifications mark context read] persisted", {
    userId,
    bookingId: canonicalBooking,
    updated: updated.rows.length,
    affectedRows: notificationIds.length,
    notificationIds,
  });

  return {
    booking_id: canonicalBooking,
    read_at: readAt,
    affected_rows: notificationIds.length,
    notification_ids: notificationIds,
    updated: updated.rows.length,
  };
}
