import { describe, expect, it } from "vitest";
import {
  bookingDashboardHrefForDetail,
  bookingDashboardHrefForRole,
  bookingStatusForActions,
  landlordCanRespondToBooking,
} from "./booking-detail-state";

describe("booking-detail-state", () => {
  it("routes landlords back to the landlord dashboard", () => {
    expect(bookingDashboardHrefForRole("landlord")).toBe("/dashboard/landlord");
    expect(bookingDashboardHrefForRole("tenant")).toBe("/dashboard/bookings");
    expect(bookingDashboardHrefForRole("other")).toBe("/dashboard");
  });

  it("prefers landlord dashboard when booking detail was opened from landlord notifications", () => {
    expect(bookingDashboardHrefForDetail({ sourceRole: "landlord", role: "other" })).toBe("/dashboard/landlord");
    expect(bookingDashboardHrefForDetail({ sourceRole: "notifications", role: "tenant" })).toBe("/dashboard/notifications");
    expect(bookingDashboardHrefForDetail({ sourceRole: null, role: "tenant" })).toBe("/dashboard/bookings");
    expect(bookingDashboardHrefForDetail({ sourceRole: null, role: "landlord" })).toBe("/dashboard/landlord");
  });

  it("only allows landlord respond actions while pending", () => {
    expect(bookingStatusForActions("created")).toBe("PENDING");
    expect(landlordCanRespondToBooking("PENDING")).toBe(true);
    expect(landlordCanRespondToBooking("CONFIRMED")).toBe(false);
    expect(landlordCanRespondToBooking("ACCEPTED")).toBe(false);
  });
});
