import { describe, expect, it } from "vitest";
import { collapseNotificationListByBookingId } from "../src/notification-list-collapse.js";

const bookingId = "65817e88-4996-4dc9-980c-dcdeb1f739bf";

describe("collapseNotificationListByBookingId", () => {
  it("shows read when any sibling row for the booking was read (context-read parity)", () => {
    const rows = collapseNotificationListByBookingId([
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        event_type: "booking.confirmed",
        created_at: "2026-05-15T04:02:37.899Z",
        read_at: "2026-05-15T04:04:39.062Z",
        payload: { booking_id: bookingId, booking_status: "CONFIRMED" },
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        event_type: "booking.confirmed",
        created_at: "2026-05-13T00:00:00.000Z",
        read_at: null,
        payload: { booking_id: bookingId, booking_status: "CONFIRMED" },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.read_at).not.toBeNull();
  });

  it("returns unread only when every duplicate row is unread", () => {
    const rows = collapseNotificationListByBookingId([
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        event_type: "booking.confirmed",
        created_at: "2026-05-15T04:02:37.899Z",
        read_at: null,
        payload: { booking_id: bookingId, booking_status: "CONFIRMED" },
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        event_type: "booking.created",
        created_at: "2026-05-13T00:00:00.000Z",
        read_at: null,
        payload: { booking_id: bookingId, booking_status: "PENDING" },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.read_at).toBeNull();
  });

  it("returns read when all duplicates for the booking are read", () => {
    const rows = collapseNotificationListByBookingId([
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        event_type: "booking.confirmed",
        created_at: "2026-05-15T04:02:37.899Z",
        read_at: "2026-05-15T04:04:39.062Z",
        payload: { booking_id: bookingId, booking_status: "CONFIRMED" },
      },
      {
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        event_type: "booking.created",
        created_at: "2026-05-13T00:00:00.000Z",
        read_at: "2026-05-13T23:00:00.000Z",
        payload: { booking_id: bookingId, booking_status: "PENDING" },
      },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.read_at).not.toBeNull();
  });
});
