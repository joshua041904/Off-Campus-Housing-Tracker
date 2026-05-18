import { describe, expect, it } from "vitest";
import {
  classifyFetchFailure,
  is429Error,
  userSafeLoadMessage,
  userSafeSearchMessage,
} from "./och-fetch-errors";

describe("och-fetch-errors", () => {
  it("detects 429 from API error messages", () => {
    expect(is429Error(new Error("notification list 429"))).toBe(true);
    expect(classifyFetchFailure(new Error("list my listings 429"))).toBe("rate-limited");
  });

  it("never exposes raw API labels in user messages", () => {
    expect(userSafeLoadMessage("notifications", "rate-limited")).not.toMatch(/429/);
    expect(userSafeLoadMessage("notifications", "rate-limited")).toContain("syncing");
    expect(userSafeSearchMessage("error")).not.toMatch(/listings search/);
  });
});
