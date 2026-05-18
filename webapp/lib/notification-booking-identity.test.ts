import { describe, expect, it } from "vitest";
import {
  mergeIdentityIntoPayload,
  renterLabelFromBookingPayload,
} from "./notification-booking-identity";

describe("mergeIdentityIntoPayload", () => {
  it("fills username from source when target only has tenant_id", () => {
    const target = { booking_status: "CONFIRMED", tenant_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" };
    const source = { tenant_username_snapshot: "tomwang04312_507ab69b2d", tenant_email: "tom@gmail.com" };
    const merged = mergeIdentityIntoPayload(target, source);
    expect(renterLabelFromBookingPayload(merged)).toBe("@tomwang04312");
  });
});

describe("renterLabelFromBookingPayload", () => {
  it("prefers renter_username over tenant_id uuid", () => {
    const label = renterLabelFromBookingPayload({
      renter_username: "tomwang04312",
      tenant_id: "1b235322-10e5-4cfb-8594-6565e67e28e9",
    });
    expect(label).toBe("@tomwang04312");
  });
});
