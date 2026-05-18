import { describe, expect, it } from "vitest";
import { cleanUsernameIdentityBase, tenantOwnsBooking } from "../src/booking-tenant-ownership.js";

describe("booking-tenant-ownership", () => {
  it("matches sibling auth accounts by username snapshot base", () => {
    const booking = {
      tenantId: "ee55ecc0-617b-4d48-b350-61c08adcb3e2",
      tenantUsernameSnapshot: "tomwang04312_507ab69b2d_a050a5643e",
    };
    expect(
      tenantOwnsBooking(booking, "1b235322-10e5-4cfb-8594-6565e67e28e9", "tomwang04312_507ab69b2d"),
    ).toBe(true);
  });

  it("rejects unrelated tenants", () => {
    expect(
      tenantOwnsBooking(
        { tenantId: "00000000-0000-4000-8000-000000000099", tenantUsernameSnapshot: "other_user" },
        "1b235322-10e5-4cfb-8594-6565e67e28e9",
        "tomwang04312",
      ),
    ).toBe(false);
  });

  it("strips generated username suffixes", () => {
    expect(cleanUsernameIdentityBase("tomwang04312_507ab69b2d_a050a5643e")).toBe("tomwang04312");
  });
});
