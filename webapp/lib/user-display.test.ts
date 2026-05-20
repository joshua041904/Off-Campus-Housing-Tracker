import { describe, expect, it } from "vitest";
import { cleanUsernameForDisplay, formatHostCounterpartyLine, formatIdentityPriority } from "./user-display";

describe("user-display", () => {
  it("strips generated hex suffixes from usernames", () => {
    expect(cleanUsernameForDisplay("tomwang04312_507ab69b2d")).toBe("tomwang04312");
    expect(formatIdentityPriority({ username: "tomwang04312_507ab69b2d" })).toBe("@tomwang04312");
  });

  it("strips repeated generated suffixes from usernames", () => {
    expect(cleanUsernameForDisplay("tomwang04312_507ab69b2d_a050a5643e")).toBe("tomwang04312");
    expect(formatIdentityPriority({ username: "tomwang04312_507ab69b2d_a050a5643e" })).toBe("@tomwang04312");
  });

  it("keeps normal underscore usernames intact", () => {
    expect(cleanUsernameForDisplay("jane_doe")).toBe("jane_doe");
  });

  it("shows full host email when landlord_email is present", () => {
    expect(
      formatHostCounterpartyLine({
        landlord_email: "tomwang22@yahoo.com",
        landlord_id: "d9206c11-7afd-41bd-8b53-f85410f473b4",
      }),
    ).toBe("Host: tomwang22@yahoo.com");
  });
});
