import { BOOKING_ID_FROM_ROW_N_SQL } from "./booking-context-sql.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type NotificationRow = Record<string, unknown> & {
  id?: string;
  event_type?: string;
  payload?: Record<string, unknown>;
  created_at?: string;
  read_at?: string | null;
  dedupe_key?: string | null;
};

function bookingIdFromRow(row: NotificationRow): string {
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
  const dl = String(payload.deep_link ?? payload.deepLink ?? "").trim();
  const m = dl.match(/\/bookings\/([0-9a-f-]{36})/i);
  return m?.[1] ? m[1].toLowerCase() : "";
}

function lifecycleRank(row: NotificationRow): number {
  const payload =
    row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
      ? row.payload
      : {};
  const st = String(payload.booking_status ?? payload.new_status ?? "").trim().toUpperCase();
  const et = String(row.event_type ?? "").toLowerCase();
  if (["CANCELLED", "CANCELED", "WITHDRAWN", "REJECTED", "EXPIRED"].includes(st)) return 100;
  if (st === "CONFIRMED" || et === "booking.confirmed") return 50;
  if (st === "ACCEPTED" || st === "PENDING_CONFIRMATION" || et === "booking.accepted") return 40;
  if (st === "PENDING" || et === "booking.created" || et.includes("request")) return 10;
  return 5;
}

function pickBookingLifecycleWinner(group: NotificationRow[]): NotificationRow {
  return group.reduce((best, cur) => (lifecycleRank(cur) > lifecycleRank(best) ? cur : best));
}

/** One list row per booking; unread only when every duplicate row in DB is unread. */
export function collapseNotificationListByBookingId(items: NotificationRow[]): NotificationRow[] {
  const withBooking: NotificationRow[] = [];
  const withoutBooking: NotificationRow[] = [];
  for (const row of items) {
    if (bookingIdFromRow(row)) withBooking.push(row);
    else withoutBooking.push(row);
  }

  const byBooking = new Map<string, NotificationRow[]>();
  for (const row of withBooking) {
    const bid = bookingIdFromRow(row);
    const g = byBooking.get(bid) ?? [];
    g.push(row);
    byBooking.set(bid, g);
  }

  const collapsed: NotificationRow[] = [...withoutBooking];
  for (const group of Array.from(byBooking.values())) {
    const winner = pickBookingLifecycleWinner(group);
    const anyRead = group.some((row) => Boolean(row.read_at));
    const readAt = anyRead
      ? group.map((row) => row.read_at).find(Boolean) ?? winner.read_at ?? null
      : null;
    collapsed.push({ ...winner, read_at: readAt });
  }

  return collapsed.sort((a, b) => {
    const ta = new Date(String(a.created_at || 0)).getTime();
    const tb = new Date(String(b.created_at || 0)).getTime();
    return tb - ta;
  });
}

export { BOOKING_ID_FROM_ROW_N_SQL };
