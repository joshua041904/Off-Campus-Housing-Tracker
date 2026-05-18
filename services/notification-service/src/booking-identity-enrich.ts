import type { Pool } from "pg";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRealHandle(v: string): boolean {
  const s = String(v || "").trim().replace(/^@+/, "");
  return Boolean(s && !UUID_RE.test(s) && /^[a-z0-9_.-]{3,}$/i.test(s));
}

const IDENTITY_KEYS = [
  "renter_username",
  "tenant_username_snapshot",
  "tenant_username",
  "tenantUsername",
  "tenantUsernameSnapshot",
  "renter_display_name",
  "tenant_display_name",
  "tenantDisplayName",
  "tenant_email",
  "tenantEmail",
] as const;

function mergeIdentityPayload(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const out = { ...target };
  for (const k of IDENTITY_KEYS) {
    const sv = source[k];
    if (sv == null || !String(sv).trim()) continue;
    const cur = out[k];
    const curS = cur != null ? String(cur).trim() : "";
    const nextS = String(sv).trim();
    if (!curS) {
      out[k] = sv;
      continue;
    }
    if (isRealHandle(nextS) && !isRealHandle(curS)) out[k] = sv;
  }
  return out;
}

/** Pull best tenant identity from other notification rows for the same booking (same recipient). */
export async function enrichBookingPayloadFromSiblingNotifications(
  pool: Pool,
  userId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const bid = String(payload.booking_id ?? payload.bookingId ?? payload.context_id ?? "").trim().toLowerCase();
  if (!UUID_RE.test(bid)) return payload;

  const r = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload
     FROM notification.notifications
     WHERE user_id = $1::uuid
       AND event_type LIKE 'booking.%'
       AND (
         LOWER(COALESCE(payload->>'booking_id', payload->>'bookingId', '')) = $2
         OR LOWER(COALESCE(payload->>'context_id', '')) = $2
       )
     ORDER BY created_at DESC
     LIMIT 24`,
    [userId, bid],
  );

  let merged = { ...payload };
  for (const row of r.rows) {
    if (row.payload && typeof row.payload === "object") {
      merged = mergeIdentityPayload(merged, row.payload);
    }
  }
  return merged;
}
