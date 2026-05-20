import { describe, expect, it } from "vitest";
import {
  assertBookingEligibleForPeerReview,
  bookingEligibleForPeerReviewSnap,
} from "../src/peer-review-booking-gate.js";

const baseSnap = {
  tenant_id: "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee",
  landlord_id: "11111111-2222-4333-8444-555555555555",
  end_date: "2099-01-01",
};

describe("peer-review-booking-gate", () => {
  it("APPROVED / ACCEPTED / PENDING_CONFIRMATION / CONFIRMED / COMPLETED are eligible", () => {
    expect(bookingEligibleForPeerReviewSnap({ ...baseSnap, status: "ACCEPTED" })).toBe(true);
    expect(bookingEligibleForPeerReviewSnap({ ...baseSnap, status: "APPROVED" })).toBe(true);
    expect(bookingEligibleForPeerReviewSnap({ ...baseSnap, status: "PENDING_CONFIRMATION" })).toBe(true);
    expect(bookingEligibleForPeerReviewSnap({ ...baseSnap, status: "CONFIRMED" })).toBe(true);
    expect(bookingEligibleForPeerReviewSnap({ ...baseSnap, status: "COMPLETED" })).toBe(true);
  });

  it("CANCELLED / REJECTED / EXPIRED / PENDING are not eligible", () => {
    expect(bookingEligibleForPeerReviewSnap({ ...baseSnap, status: "CANCELLED" })).toBe(false);
    expect(bookingEligibleForPeerReviewSnap({ ...baseSnap, status: "REJECTED" })).toBe(false);
    expect(bookingEligibleForPeerReviewSnap({ ...baseSnap, status: "EXPIRED" })).toBe(false);
    expect(bookingEligibleForPeerReviewSnap({ ...baseSnap, status: "PENDING" })).toBe(false);
    expect(bookingEligibleForPeerReviewSnap({ ...baseSnap, status: "CREATED" })).toBe(false);
  });

  it("assertBookingEligibleForPeerReview allows reviewer/reviewee parties on ACCEPTED", () => {
    const snap = { ...baseSnap, status: "ACCEPTED" };
    const g = assertBookingEligibleForPeerReview(snap, baseSnap.tenant_id, baseSnap.landlord_id);
    expect(g.ok).toBe(true);
  });
});
