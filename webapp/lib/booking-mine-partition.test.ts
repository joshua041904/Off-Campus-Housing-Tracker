import { describe, expect, it } from "vitest";
import type { TenantBookingSummary } from "./api";
import {
  filterDashboardRecentBookings,
  isDashboardRecentBookingRow,
  isPastBookingRow,
  isUpcomingBookingRow,
  partitionBookingsUpcomingPast,
} from "./booking-mine-partition";

function row(status: string, endDate: string): TenantBookingSummary {
  return {
    booking_id: `bid-${status}-${endDate}`,
    status,
    startDate: "2026-05-01",
    endDate,
    duration_days: 5,
    expires_at: "",
    listing_id: "listing-1",
  };
}

describe("booking-mine-partition", () => {
  const now = new Date("2026-05-16T12:00:00.000Z");

  it("excludes cancelled/expired from upcoming", () => {
    expect(isUpcomingBookingRow(row("cancelled", "2026-06-01"), now)).toBe(false);
    expect(isUpcomingBookingRow(row("expired", "2026-06-01"), now)).toBe(false);
    expect(isUpcomingBookingRow(row("confirmed", "2026-06-01"), now)).toBe(true);
  });

  it("puts ended active status in past when end_date is before today", () => {
    expect(isPastBookingRow(row("confirmed", "2026-05-10"), now)).toBe(true);
  });

  it("dashboard recent excludes draft created but keeps all confirmed upcoming", () => {
    expect(isDashboardRecentBookingRow(row("created", "2026-06-01"), now)).toBe(false);
    expect(isDashboardRecentBookingRow(row("confirmed", "2026-06-01"), now)).toBe(true);
    const recent = filterDashboardRecentBookings(
      [
        row("created", "2026-06-01"),
        row("confirmed", "2026-06-01"),
        row("confirmed", "2027-05-21"),
        row("cancelled", "2026-06-01"),
      ],
      { now },
    );
    expect(recent).toHaveLength(2);
    expect(recent.every((b) => String(b.status).toLowerCase() === "confirmed")).toBe(true);
  });

  it("partitions upcoming vs past for full page", () => {
    const { upcoming, past } = partitionBookingsUpcomingPast(
      [
        row("cancelled", "2026-06-01"),
        row("confirmed", "2026-06-01"),
        row("confirmed", "2026-05-01"),
      ],
      { now },
    );
    expect(upcoming).toHaveLength(1);
    expect(past).toHaveLength(2);
  });
});
