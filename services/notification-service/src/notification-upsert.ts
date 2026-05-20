import type { Pool } from "pg";
import { enrichBookingPayloadFromSiblingNotifications } from "./booking-identity-enrich.js";

function isUniqueViolation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && (err as { code?: string }).code === "23505");
}

export type UpsertNotificationResult = {
  inserted: boolean;
  notificationId: string | null;
  readAt: string | null;
};

/**
 * Insert or merge payload by dedupe_key. Never touches read_at.
 * Returns inserted=true only when a new row was created (caller may realtime-push).
 */
export async function upsertNotificationByDedupeKey(
  pool: Pool,
  input: {
    userId: string;
    eventType: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
  },
): Promise<UpsertNotificationResult> {
  const userId = String(input.userId || "").trim().toLowerCase();
  const dk = String(input.dedupeKey || "").trim();
  const eventType = String(input.eventType || "").trim().slice(0, 120);
  if (!userId || !dk || !eventType) {
    return { inserted: false, notificationId: null, readAt: null };
  }
  const enriched = await enrichBookingPayloadFromSiblingNotifications(pool, userId, input.payload);
  const payloadJson = JSON.stringify(enriched);

  const existing = await pool.query<{ id: string; read_at: string | null }>(
    `SELECT id::text, read_at FROM notification.notifications
     WHERE dedupe_key = $1 AND user_id = $2::uuid
     LIMIT 1`,
    [dk, userId],
  );
  if (existing.rows.length > 0) {
    await pool.query(
      `UPDATE notification.notifications
       SET payload = notification.notifications.payload || $1::jsonb
       WHERE dedupe_key = $2 AND user_id = $3::uuid`,
      [payloadJson, dk, userId],
    );
    const row = existing.rows[0];
    return { inserted: false, notificationId: row?.id ?? null, readAt: row?.read_at ?? null };
  }

  const bid = String(enriched.booking_id ?? enriched.bookingId ?? enriched.context_id ?? "")
    .trim()
    .toLowerCase();
  let inheritedReadAt: string | null = null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bid)) {
    const priorRead = await pool.query<{ read_at: string }>(
      `SELECT read_at
       FROM notification.notifications
       WHERE user_id = $1::uuid
         AND read_at IS NOT NULL
         AND (
           LOWER(COALESCE(payload->>'context_id', '')) = $2
           OR LOWER(COALESCE(payload->>'booking_id', '')) = $2
           OR LOWER(COALESCE(payload->>'bookingId', '')) = $2
           OR payload::text ILIKE '%' || $2 || '%'
         )
       ORDER BY read_at DESC
       LIMIT 1`,
      [userId, bid],
    );
    inheritedReadAt = priorRead.rows[0]?.read_at?.toString() ?? null;
  }

  try {
    const ins = await pool.query<{ id: string; read_at: string | null }>(
      `INSERT INTO notification.notifications (user_id, event_type, channel, status, payload, dedupe_key, read_at)
       VALUES ($1::uuid, $2, 'push'::notification.notification_channel, 'pending', $3::jsonb, $4, $5::timestamptz)
       RETURNING id::text, read_at`,
      [userId, eventType, payloadJson, dk, inheritedReadAt],
    );
    const row = ins.rows[0];
    return { inserted: true, notificationId: row?.id ?? null, readAt: row?.read_at ?? null };
  } catch (e: unknown) {
    if (!isUniqueViolation(e)) throw e;
    await pool.query(
      `UPDATE notification.notifications
       SET payload = notification.notifications.payload || $1::jsonb
       WHERE dedupe_key = $2 AND user_id = $3::uuid`,
      [payloadJson, dk, userId],
    );
    const again = await pool.query<{ id: string; read_at: string | null }>(
      `SELECT id::text, read_at FROM notification.notifications
       WHERE dedupe_key = $1 AND user_id = $2::uuid LIMIT 1`,
      [dk, userId],
    );
    const row = again.rows[0];
    return { inserted: false, notificationId: row?.id ?? null, readAt: row?.read_at ?? null };
  }
}
