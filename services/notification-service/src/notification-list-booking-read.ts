import { BOOKING_ID_FROM_ROW_N_SQL } from "./booking-context-sql.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type NotificationListRow = Record<string, unknown> & {
  id?: string;
  event_type?: string;
  payload?: Record<string, unknown>;
  read_at?: string | null;
};

function bookingIdFromRow(row: NotificationListRow): string {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? row.payload
      : {};
  const fromPayload = String(
    payload.context_id ?? payload.booking_id ?? payload.bookingId ?? "",
  )
    .trim()
    .toLowerCase();
  if (UUID_RE.test(fromPayload)) return fromPayload;
  const links = [
    payload.deep_link,
    payload.deepLink,
    payload.href,
    payload.action_url,
    payload.actionUrl,
  ]
    .map((v) => String(v ?? "").trim())
    .filter(Boolean);
  for (const link of links) {
    const m = link.match(/\/bookings\/([0-9a-f-]{36})/i);
    if (m?.[1] && UUID_RE.test(m[1])) return m[1].toLowerCase();
  }
  const dk = String(row.dedupe_key ?? "");
  const dm = dk.match(/:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):/i);
  if (dm?.[1]) return dm[1].toLowerCase();
  return "";
}

/**
 * Display/API rule: if any row in a booking context has read_at, every sibling row
 * in the response uses the earliest context read_at (DB sync should already match).
 */
export function applyBookingContextReadStateToRows(rows: NotificationListRow[]): NotificationListRow[] {
  const withBooking: NotificationListRow[] = [];
  const withoutBooking: NotificationListRow[] = [];
  for (const row of rows) {
    if (bookingIdFromRow(row)) withBooking.push(row);
    else withoutBooking.push(row);
  }

  const byBooking = new Map<string, NotificationListRow[]>();
  for (const row of withBooking) {
    const bid = bookingIdFromRow(row);
    const g = byBooking.get(bid) ?? [];
    g.push(row);
    byBooking.set(bid, g);
  }

  const normalized: NotificationListRow[] = [...withoutBooking];
  for (const group of Array.from(byBooking.values())) {
    const readTimes = group
      .map((row) => row.read_at)
      .filter((v): v is string => Boolean(v))
      .sort();
    const contextReadAt = readTimes[0] ?? null;
    for (const row of group) {
      normalized.push(
        contextReadAt && !row.read_at ? { ...row, read_at: contextReadAt } : row,
      );
    }
  }

  return normalized.sort((a, b) => {
    const ta = new Date(String(a.created_at || 0)).getTime();
    const tb = new Date(String(b.created_at || 0)).getTime();
    return tb - ta;
  });
}

/** Unread bell: one per booking context with zero read rows. */
export function countBookingContextUnreadRows(rows: NotificationListRow[]): number {
  const normalized = applyBookingContextReadStateToRows(rows);
  const byBooking = new Map<string, NotificationListRow[]>();
  for (const row of normalized) {
    const bid = bookingIdFromRow(row);
    if (!bid) continue;
    const g = byBooking.get(bid) ?? [];
    g.push(row);
    byBooking.set(bid, g);
  }
  let unreadContexts = 0;
  for (const group of Array.from(byBooking.values())) {
    if (group.every((row) => !row.read_at)) unreadContexts += 1;
  }
  const nonBookingUnread = normalized.filter((row) => !bookingIdFromRow(row) && !row.read_at).length;
  return unreadContexts + nonBookingUnread;
}

export { BOOKING_ID_FROM_ROW_N_SQL, bookingIdFromRow };
