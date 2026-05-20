import { describe, expect, it, beforeEach } from "vitest";
import type { NotificationItem } from "./api";
import {
  applyReadOverlayToNotificationItems,
  applyReadOverlayToBookingProjection,
  clearReadOverlay,
  getReadOverlay,
  recordNotificationReadOverlay,
} from "./notification-read-overlay";

function bookingItem(id: string, bookingId: string, readAt?: string): NotificationItem {
  return {
    id,
    event_type: "booking.confirmed",
    channel: "push",
    status: "sent",
    created_at: "2026-05-15T00:00:00.000Z",
    read_at: readAt ?? null,
    payload: {
      category: "booking",
      context_id: bookingId,
      booking_id: bookingId,
      notification_audience: "landlord",
    },
  };
}

describe("notification-read-overlay", () => {
  beforeEach(() => {
    getReadOverlay().notificationIds.clear();
    getReadOverlay().bookingIds.clear();
  });

  it("marks all rows for a booking read after och:notifications-read", () => {
    const bookingId = "65817e88-4996-4dc9-980c-dcdeb1f739bf";
    const rows = [
      bookingItem("a", bookingId, "2026-05-15T00:00:00.000Z"),
      bookingItem("b", bookingId),
    ];
    recordNotificationReadOverlay({
      bookingId,
      readAt: "2026-05-16T00:00:00.000Z",
    });
    const merged = applyReadOverlayToNotificationItems(rows);
    expect(merged.every((row) => row.read_at)).toBe(true);
  });

  it("keeps stale refetch rows read when overlay has booking id", () => {
    const bookingId = "65817e88-4996-4dc9-980c-dcdeb1f739bf";
    recordNotificationReadOverlay({ bookingId, readAt: "2026-05-16T00:00:00.000Z" });
    const stale = [bookingItem("b", bookingId)];
    expect(applyReadOverlayToNotificationItems(stale)[0]?.read_at).toBe("2026-05-16T00:00:00.000Z");
  });

  it("clearReadOverlay resets session optimistic state", () => {
    recordNotificationReadOverlay({ bookingId: "65817e88-4996-4dc9-980c-dcdeb1f739bf" });
    clearReadOverlay();
    expect(getReadOverlay().bookingIds.size).toBe(0);
    const stale = [bookingItem("b", "65817e88-4996-4dc9-980c-dcdeb1f739bf")];
    expect(applyReadOverlayToNotificationItems(stale)[0]?.read_at).toBeNull();
  });

  it("applies overlay to booking projections", () => {
    recordNotificationReadOverlay({ bookingId: "65817e88-4996-4dc9-980c-dcdeb1f739bf" });
    const rows = applyReadOverlayToBookingProjection([
      {
        bookingId: "65817e88-4996-4dc9-980c-dcdeb1f739bf",
        isUnread: true,
        notificationId: "x",
      },
    ]);
    expect(rows[0]?.isUnread).toBe(false);
  });
});
