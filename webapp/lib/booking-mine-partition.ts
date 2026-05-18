import type { TenantBookingSummary } from "./api";

const ACTIVE_STATUSES = new Set(["created", "pending_confirmation", "confirmed"]);
const DASHBOARD_RECENT_STATUSES = new Set(["pending_confirmation", "confirmed"]);
const PAST_TERMINAL_STATUSES = new Set(["cancelled", "rejected", "expired", "completed"]);

function utcDayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function parseYmd(ymd: string): number | null {
  const s = String(ymd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T00:00:00.000Z`).getTime();
}

/** Search dashboard Recent bookings: confirmed / awaiting landlord only (no draft `created`). */
export function isDashboardRecentBookingRow(b: TenantBookingSummary, now = new Date()): boolean {
  const status = String(b.status || "")
    .trim()
    .toLowerCase();
  if (!DASHBOARD_RECENT_STATUSES.has(status)) return false;
  return isUpcomingBookingRow(b, now);
}

export function filterDashboardRecentBookings(
  rows: TenantBookingSummary[],
  opts?: { now?: Date },
): TenantBookingSummary[] {
  const now = opts?.now ?? new Date();
  return rows
    .filter((b) => isDashboardRecentBookingRow(b, now))
    .sort((a, b) => {
      const sa = parseYmd(a.startDate) ?? 0;
      const sb = parseYmd(b.startDate) ?? 0;
      if (sa !== sb) return sa - sb;
      return String(b.booking_id).localeCompare(String(a.booking_id));
    });
}

export function isUpcomingBookingRow(b: TenantBookingSummary, now = new Date()): boolean {
  const status = String(b.status || "")
    .trim()
    .toLowerCase();
  if (PAST_TERMINAL_STATUSES.has(status)) return false;
  if (!ACTIVE_STATUSES.has(status)) return false;
  const endMs = parseYmd(b.endDate);
  if (endMs == null) return true;
  return endMs >= utcDayStart(now);
}

export function isPastBookingRow(b: TenantBookingSummary, now = new Date()): boolean {
  const status = String(b.status || "")
    .trim()
    .toLowerCase();
  if (PAST_TERMINAL_STATUSES.has(status)) return true;
  const endMs = parseYmd(b.endDate);
  if (endMs == null) return false;
  return endMs < utcDayStart(now);
}

export function partitionBookingsUpcomingPast(
  rows: TenantBookingSummary[],
  opts?: { now?: Date; includeHidden?: boolean },
): { upcoming: TenantBookingSummary[]; past: TenantBookingSummary[] } {
  const now = opts?.now ?? new Date();
  const includeHidden = Boolean(opts?.includeHidden);
  const upcoming: TenantBookingSummary[] = [];
  const past: TenantBookingSummary[] = [];

  for (const b of rows) {
    const hidden = Boolean(b.tenant_archived_at);
    if (hidden && !includeHidden) continue;
    if (hidden && includeHidden && isUpcomingBookingRow(b, now)) {
      upcoming.push(b);
      continue;
    }
    if (isUpcomingBookingRow(b, now)) {
      upcoming.push(b);
    } else if (isPastBookingRow(b, now)) {
      past.push(b);
    } else if (hidden && includeHidden) {
      past.push(b);
    }
  }

  upcoming.sort((a, b) => {
    const sa = parseYmd(a.startDate) ?? 0;
    const sb = parseYmd(b.startDate) ?? 0;
    if (sa !== sb) return sa - sb;
    return String(b.booking_id).localeCompare(String(a.booking_id));
  });

  past.sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));

  return { upcoming, past };
}
