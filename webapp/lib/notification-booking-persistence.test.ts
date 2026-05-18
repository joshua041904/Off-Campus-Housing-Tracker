import { describe, expect, it } from "vitest";
import type { NotificationItem } from "./api";
import { clearReadOverlay } from "./notification-read-overlay";
import { projectLandlordDashboardBookingRows } from "./booking-notification-projection";

const landlordUserId = "d9206c11-7afd-41bd-8b53-f85410f473b4";
const bookingId = "65817e88-4996-4dc9-980c-dcdeb1f739bf";
const listingId = "12121212-1212-4121-8121-121212121212";

function bookingRow(
  id: string,
  eventType: string,
  createdAt: string,
  readAt?: string,
): NotificationItem {
  return {
    id,
    event_type: eventType,
    channel: "push",
    status: "sent",
    created_at: createdAt,
    read_at: readAt ?? null,
    payload: {
      category: "booking",
      context_id: bookingId,
      booking_id: bookingId,
      notification_audience: "landlord",
      notification_category: "booking_landlord",
      listing_id: listingId,
      tenant_username: "renter_sam",
      booking_status: eventType === "booking.created" ? "PENDING" : "CONFIRMED",
    },
  };
}

describe("notification booking persistence (API read_at)", () => {
  it("collapses duplicate lifecycle rows and reflects durable read_at without overlay", () => {
    clearReadOverlay();
    const items = [
      bookingRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "booking.confirmed", "2026-05-15T00:00:00.000Z", "2026-05-15T04:00:00.000Z"),
      bookingRow("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "booking.confirmed", "2026-05-13T00:00:00.000Z", "2026-05-13T23:00:00.000Z"),
    ];
    const rows = projectLandlordDashboardBookingRows(items, {
      currentUserId: landlordUserId,
      landlordMineBookings: [],
      landlordListingIds: new Set([listingId]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isUnread).toBe(false);
    expect(rows[0]?.bookingId).toBe(bookingId);
  });

  it("renders Read from API read_at without session overlay", () => {
    clearReadOverlay();
    const items = [
      bookingRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "booking.confirmed", "2026-05-15T00:00:00.000Z", "2026-05-15T04:00:00.000Z"),
      bookingRow("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "booking.confirmed", "2026-05-13T00:00:00.000Z", "2026-05-13T23:00:00.000Z"),
    ];
    const rows = projectLandlordDashboardBookingRows(items, {
      currentUserId: landlordUserId,
      landlordMineBookings: [],
      landlordListingIds: new Set([listingId]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isUnread).toBe(false);
  });

  it("treats booking context as read when any sibling row has read_at", () => {
    clearReadOverlay();
    const items = [
      bookingRow("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "booking.confirmed", "2026-05-15T00:00:00.000Z", "2026-05-15T04:00:00.000Z"),
      bookingRow("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "booking.confirmed", "2026-05-13T00:00:00.000Z"),
    ];
    const rows = projectLandlordDashboardBookingRows(items, {
      currentUserId: landlordUserId,
      landlordMineBookings: [],
      landlordListingIds: new Set([listingId]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.isUnread).toBe(false);
  });
});
