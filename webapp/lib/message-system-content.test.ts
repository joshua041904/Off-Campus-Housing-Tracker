import { describe, expect, it } from "vitest";
import { isSystemEventContent } from "./message-system-content";

describe("isSystemEventContent", () => {
  it("treats booking notice types as system", () => {
    expect(isSystemEventContent("anything", "BookingNotice")).toBe(true);
    expect(isSystemEventContent("x", "booking_update")).toBe(true);
  });

  it("does not treat user-authored chat as system", () => {
    expect(
      isSystemEventContent(
        "You canceled booking, wanna book again as I know you need a place to stay",
        "text",
      ),
    ).toBe(false);
  });

  it("treats lifecycle copy as system", () => {
    expect(isSystemEventContent("Your booking was confirmed for 2 room apt")).toBe(true);
  });
});
