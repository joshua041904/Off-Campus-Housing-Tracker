import { describe, expect, it } from "vitest";
import {
  applyBookingContextReadStateToRows,
  countBookingContextUnreadRows,
} from "../src/notification-list-booking-read.js";

const bookingId = "65817e88-4996-4dc9-980c-dcdeb1f739bf";

describe("applyBookingContextReadStateToRows", () => {
  it("marks confirmed unread as read when cancelled sibling was read", () => {
    const rows = applyBookingContextReadStateToRows([
      {
        id: "a",
        event_type: "booking.confirmed",
        created_at: "2026-05-15T04:02:37.899Z",
        read_at: null,
        payload: { booking_id: bookingId },
      },
      {
        id: "b",
        event_type: "booking.cancelled",
        created_at: "2026-05-14T00:00:00.000Z",
        read_at: "2026-05-15T04:04:39.062Z",
        payload: { booking_id: bookingId },
      },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.read_at)).toBe(true);
  });

  it("counts one unread booking context when all lifecycle rows are unread", () => {
    const unread = countBookingContextUnreadRows([
      {
        id: "a",
        event_type: "booking.confirmed",
        read_at: null,
        payload: { booking_id: bookingId },
      },
      {
        id: "b",
        event_type: "booking.cancelled",
        read_at: null,
        payload: { booking_id: bookingId },
      },
    ]);
    expect(unread).toBe(1);
  });

  it("counts zero unread booking contexts after any sibling was read", () => {
    const unread = countBookingContextUnreadRows([
      {
        id: "a",
        event_type: "booking.confirmed",
        read_at: null,
        payload: { booking_id: bookingId },
      },
      {
        id: "b",
        event_type: "booking.cancelled",
        read_at: "2026-05-15T04:04:39.062Z",
        payload: { booking_id: bookingId },
      },
    ]);
    expect(unread).toBe(0);
  });
});
