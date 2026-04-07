/**
 * Reserved: **booking → analytics** event contract.
 *
 * Today `analytics-service` consumes **listing.events** (see `listing-analytics.contract.test.ts`) and messaging-related topics,
 * not `dev.booking.events.v1`. When a booking-events consumer + projection exists, implement this suite and remove `.skip`.
 */
import { describe, it } from "vitest";

describe.skip("system contract: booking event → analytics (not yet wired)", () => {
  it("placeholder — add consumer + projection, then assert analytics DB from BookingConfirmedV1 (or equivalent)", () => {
    expect(true).toBe(false);
  });
});
