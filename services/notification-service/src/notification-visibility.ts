/** Shared visibility + booking-context SQL for list, unread-count, and mark-read. */

export type NotificationAudienceScope = "user" | "landlord" | "all";

export type NotificationRowDiagnostic = {
  id: string;
  event_type: string;
  category: string | null;
  audience: string | null;
  context_id: string | null;
  payload_booking_id: string | null;
  payload_bookingId: string | null;
  deep_link: string | null;
  read_at: string | null;
  created_at: string;
};

export function diagnosticsEnabled(): boolean {
  return (
    process.env.NOTIFICATION_DIAGNOSTICS === "1" ||
    process.env.NOTIFICATION_DIAGNOSTICS !== "0"
  );
}

export function rowToDiagnostic(row: Record<string, unknown>): NotificationRowDiagnostic {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};
  return {
    id: String(row.id ?? ""),
    event_type: String(row.event_type ?? ""),
    category: String(payload.category ?? payload.notification_category ?? "").trim() || null,
    audience: String(payload.notification_audience ?? "").trim() || null,
    context_id: String(payload.context_id ?? "").trim() || null,
    payload_booking_id: String(payload.booking_id ?? "").trim() || null,
    payload_bookingId: String(payload.bookingId ?? "").trim() || null,
    deep_link: String(payload.deep_link ?? payload.deepLink ?? "").trim() || null,
    read_at: row.read_at != null ? String(row.read_at) : null,
    created_at: String(row.created_at ?? ""),
  };
}

export function logNotificationDiagnostics(
  route: string,
  meta: {
    userId: string;
    params?: Record<string, unknown>;
    returnedCount?: number;
    unreadCount?: number;
    notificationIds?: string[];
    bookingContextIds?: string[];
    rows?: NotificationRowDiagnostic[];
  },
): void {
  if (!diagnosticsEnabled()) return;
  const rows = (meta.rows ?? []).slice(0, 25);
  console.info("[notifications diagnostics]", {
    userId: meta.userId,
    route,
    params: meta.params ?? {},
    returnedCount: meta.returnedCount ?? rows.length,
    unreadCount: meta.unreadCount,
    notificationIds: meta.notificationIds ?? rows.map((r) => r.id),
    bookingContextIds: meta.bookingContextIds ?? [],
    rows,
  });
}

/** Rows eligible for in-app surfaces (not hidden). */
export function visibleNotificationWhereClause(alias = "n"): string {
  return `
    ${alias}.user_id = $1::uuid
    AND COALESCE((${alias}.payload->>'hidden')::boolean, false) = false
  `;
}

/** User /dashboard/notifications inbox. */
export function userSurfaceWhereClause(alias = "n"): string {
  return `
    ${visibleNotificationWhereClause(alias)}
    AND (
      COALESCE(${alias}.payload->>'notification_audience', '') IN ('', 'user', 'tenant', 'renter', 'both')
      OR (
        COALESCE(${alias}.payload->>'notification_audience', '') = 'landlord'
        AND COALESCE(${alias}.payload->>'notification_category', '') NOT IN ('booking_landlord', 'booking_renter')
        AND ${alias}.event_type NOT LIKE 'booking.%'
      )
    )
  `;
}

/** Landlord dashboard notification surfaces. */
export function landlordSurfaceWhereClause(alias = "n"): string {
  return `
    ${visibleNotificationWhereClause(alias)}
    AND (
      COALESCE(${alias}.payload->>'notification_audience', '') = 'landlord'
      OR COALESCE(${alias}.payload->>'notification_category', '') = 'booking_landlord'
      OR (
        ${alias}.event_type LIKE 'booking.%'
        AND COALESCE(${alias}.payload->>'notification_audience', '') <> 'tenant'
      )
    )
  `;
}

export function surfaceWhereClause(scope: NotificationAudienceScope, alias = "n"): string {
  if (scope === "landlord") return landlordSurfaceWhereClause(alias);
  if (scope === "user") return userSurfaceWhereClause(alias);
  return visibleNotificationWhereClause(alias);
}

export function isBookingCategoryRow(row: Record<string, unknown>): boolean {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? (row.payload as Record<string, unknown>)
      : {};
  const category = String(payload.category ?? "").trim().toLowerCase();
  const notifCat = String(payload.notification_category ?? "").trim().toLowerCase();
  const eventType = String(row.event_type ?? "").trim().toLowerCase();
  return (
    category === "booking" ||
    notifCat === "booking_landlord" ||
    notifCat === "booking_renter" ||
    eventType.startsWith("booking.")
  );
}

export const BOOKING_ID_FROM_ROW_N_SQL = `
  COALESCE(
    NULLIF(n.payload->>'context_id', ''),
    NULLIF(n.payload->>'booking_id', ''),
    NULLIF(n.payload->>'bookingId', ''),
    NULLIF(n.payload->>'bookingID', ''),
    NULLIF(substring(COALESCE(n.payload->>'deep_link', n.payload->>'deepLink', '') from '/bookings/([0-9a-fA-F-]{36})'), '')
  )
`;

export const BOOKING_ID_FROM_ROW_SQL = `
  COALESCE(
    NULLIF(payload->>'context_id', ''),
    NULLIF(payload->>'booking_id', ''),
    NULLIF(payload->>'bookingId', ''),
    NULLIF(payload->>'bookingID', ''),
    NULLIF(substring(COALESCE(payload->>'deep_link', payload->>'deepLink', '') from '/bookings/([0-9a-fA-F-]{36})'), '')
  )
`;

export const BOOKING_CONTEXT_MATCH_FOR_BOOKING_SQL = `
  (
    COALESCE(payload->>'category', '') = 'booking'
    OR COALESCE(payload->>'notification_category', '') IN ('booking_renter', 'booking_landlord')
    OR event_type LIKE 'booking.%'
  )
  AND (
    ${BOOKING_ID_FROM_ROW_SQL} = $2
    OR COALESCE(payload->>'deep_link', payload->>'deepLink', '') LIKE $3
  )
`;
