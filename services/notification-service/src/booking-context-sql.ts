/** Shared booking-id extraction and match predicates for mark-context-read. */

export const UUID_PATTERN = `'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`;

const BOOKING_PATH_FROM_LINKS_SQL = `
  NULLIF(substring(
    COALESCE(
      payload->>'deep_link',
      payload->>'deepLink',
      payload->>'href',
      payload->>'action_url',
      payload->>'actionUrl',
      ''
    ) from '/bookings/([0-9a-fA-F-]{36})'
  ), '')
`;

export const BOOKING_ID_FROM_PAYLOAD_SQL = `
  LOWER(COALESCE(
    CASE WHEN COALESCE(payload->>'category', '') = 'booking' THEN NULLIF(payload->>'context_id', '') END,
    NULLIF(payload->>'context_id', ''),
    NULLIF(payload->>'booking_id', ''),
    NULLIF(payload->>'bookingId', ''),
    NULLIF(payload->>'bookingID', ''),
    ${BOOKING_PATH_FROM_LINKS_SQL}
  ))
`;

export const BOOKING_ID_FROM_ROW_N_SQL = BOOKING_ID_FROM_PAYLOAD_SQL.replace(/payload/g, "n.payload");

export const IS_BOOKING_NOTIFICATION_ROW_SQL = `
  (
    COALESCE(payload->>'category', '') = 'booking'
    OR COALESCE(payload->>'notification_category', '') IN ('booking_renter', 'booking_landlord')
    OR event_type LIKE 'booking.%'
  )
`;

export const IS_BOOKING_NOTIFICATION_ROW_N_SQL = IS_BOOKING_NOTIFICATION_ROW_SQL.replace(
  /payload/g,
  "n.payload",
).replace(/event_type/g, "n.event_type");

/** Match rows for user + canonical booking id (booking param is a SQL expression, e.g. cb.booking_id). */
export function bookingContextMatchForBookingSql(alias = "n", bookingParam = "$booking"): string {
  const p = alias === "n" ? "n.payload" : `${alias}.payload`;
  const dk = alias === "n" ? "n.dedupe_key" : `${alias}.dedupe_key`;
  const uid = alias === "n" ? "n.user_id" : `${alias}.user_id`;
  const idExpr = alias === "n" ? BOOKING_ID_FROM_ROW_N_SQL : BOOKING_ID_FROM_PAYLOAD_SQL.replace(/payload/g, p);
  return `
    (
      ${idExpr} = LOWER(${bookingParam}::text)
      OR LOWER(COALESCE(NULLIF(${p}->>'context_id', ''), '')) = LOWER(${bookingParam}::text)
      OR LOWER(COALESCE(NULLIF(${p}->>'booking_id', ''), '')) = LOWER(${bookingParam}::text)
      OR LOWER(COALESCE(NULLIF(${p}->>'bookingId', ''), '')) = LOWER(${bookingParam}::text)
      OR LOWER(COALESCE(NULLIF(${p}->>'bookingID', ''), '')) = LOWER(${bookingParam}::text)
      OR COALESCE(${p}->>'deep_link', ${p}->>'deepLink', ${p}->>'href', ${p}->>'action_url', ${p}->>'actionUrl', '') ILIKE '%' || ${bookingParam}::text || '%'
      OR ${p}::text ILIKE '%' || ${bookingParam}::text || '%'
      OR COALESCE(${dk}, '') ILIKE '%:' || ${bookingParam}::text || ':%'
    )
  `;
}

/** Seed lookup: find booking context from notification id and/or explicit booking id. */
export function bookingContextSeedWhereSql(alias = "n"): string {
  const p = alias === "n" ? "n.payload" : `${alias}.payload`;
  const idExpr = alias === "n" ? BOOKING_ID_FROM_ROW_N_SQL : BOOKING_ID_FROM_PAYLOAD_SQL.replace(/payload/g, p);
  return `
    (
      ($2::text <> '' AND ${alias}.id = $2::uuid)
      OR (
        $3::text <> ''
        AND (
          ${idExpr} = LOWER($3::text)
          OR LOWER(COALESCE(NULLIF(${p}->>'context_id', ''), '')) = LOWER($3::text)
          OR LOWER(COALESCE(NULLIF(${p}->>'booking_id', ''), '')) = LOWER($3::text)
          OR LOWER(COALESCE(NULLIF(${p}->>'bookingId', ''), '')) = LOWER($3::text)
          OR COALESCE(${p}->>'deep_link', ${p}->>'deepLink', ${p}->>'href', ${p}->>'action_url', ${p}->>'actionUrl', '') ILIKE '%' || $3::text || '%'
          OR ${p}::text ILIKE '%' || $3::text || '%'
          OR COALESCE(${alias}.dedupe_key, '') ILIKE '%:' || $3::text || ':%'
        )
      )
    )
  `;
}

export function bookingPathLikePattern(bookingId: string): string {
  return `%${bookingId}%`;
}
