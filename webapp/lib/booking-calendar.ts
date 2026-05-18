function parseMonthAnchor(ymd: string | null | undefined): Date | null {
  const raw = String(ymd ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const dt = new Date(`${raw}T12:00:00.000Z`);
  if (!Number.isFinite(dt.getTime())) return null;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
}

function monthKey(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function addUtcMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function diffUtcMonths(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
}

export function deriveBookingCalendarViewport(input: {
  bookingStartDate?: string | null;
  bookingEndDate?: string | null;
  availableFromYmd?: string | null;
  calendarMonthOffset?: number;
  todayYmd?: string | null;
}): {
  leftMonthStart: Date;
  rightMonthStart: Date;
  leftMonthKey: string;
  rightMonthKey: string;
  endMonthKey: string | null;
  endMonthVisible: boolean;
  jumpToEndOffset: number | null;
} {
  const startMonth =
    parseMonthAnchor(input.bookingStartDate) ||
    parseMonthAnchor(input.availableFromYmd) ||
    parseMonthAnchor(input.todayYmd) ||
    new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const offset = Number.isFinite(Number(input.calendarMonthOffset))
    ? Math.trunc(Number(input.calendarMonthOffset))
    : 0;
  const leftMonthStart = addUtcMonths(startMonth, offset);
  const endMonth = parseMonthAnchor(input.bookingEndDate);
  const endMonthKey = endMonth ? monthKey(endMonth) : null;
  const endDiff = endMonth ? diffUtcMonths(leftMonthStart, endMonth) : null;
  const rightMonthStart =
    endMonth && endDiff != null && endDiff > 1 ? endMonth : addUtcMonths(leftMonthStart, 1);
  const endMonthVisible = endMonth ? monthKey(rightMonthStart) === endMonthKey || monthKey(leftMonthStart) === endMonthKey : false;
  return {
    leftMonthStart,
    rightMonthStart,
    leftMonthKey: monthKey(leftMonthStart),
    rightMonthKey: monthKey(rightMonthStart),
    endMonthKey,
    endMonthVisible,
    jumpToEndOffset: endMonth && endDiff != null && endDiff > 1 ? diffUtcMonths(startMonth, endMonth) : null,
  };
}
