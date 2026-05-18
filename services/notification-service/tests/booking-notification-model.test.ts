import { describe, expect, it } from "vitest";
import { bookingNotificationEventForStatus, buildNotificationDedupeKey } from "../src/booking-notification-model.js";

describe("booking-notification-model", () => {
  it("maps tenant approval statuses to booking.accepted", () => {
    expect(bookingNotificationEventForStatus("ACCEPTED", "tenant")).toBe("booking.accepted");
    expect(bookingNotificationEventForStatus("pending_confirmation", "tenant")).toBe("booking.accepted");
    expect(bookingNotificationEventForStatus("confirmed", "tenant")).toBe("booking.accepted");
  });

  it("maps landlord approval statuses to booking.confirmed", () => {
    expect(bookingNotificationEventForStatus("ACCEPTED", "landlord")).toBe("booking.confirmed");
    expect(bookingNotificationEventForStatus("CONFIRMED", "landlord")).toBe("booking.confirmed");
  });

  it("buildNotificationDedupeKey is stable", () => {
    expect(
      buildNotificationDedupeKey({
        recipientUserId: "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
        eventType: "booking.created",
        contextType: "booking",
        contextId: "11111111-2222-3333-4444-555555555555",
        statusSegment: "PENDING",
      }),
    ).toBe(
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee:booking.created:booking:11111111-2222-3333-4444-555555555555:PENDING",
    );
  });
});
