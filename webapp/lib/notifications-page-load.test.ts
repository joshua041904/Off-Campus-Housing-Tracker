import { describe, expect, it } from "vitest";
import {
  isNotificationsFetchFailure,
  mergeNotificationsLoadState,
} from "./notifications-page-load";

describe("notifications-page-load", () => {
  it("marks total failure as rate-limited when any surface is 429", () => {
    const state = mergeNotificationsLoadState("rate-limited", "rate-limited", false);
    expect(state).toBe("rate-limited");
    expect(isNotificationsFetchFailure(state, false)).toBe(true);
  });

  it("returns loaded when at least one fetch succeeded", () => {
    const state = mergeNotificationsLoadState("loaded", "rate-limited", true);
    expect(state).toBe("loaded");
    expect(isNotificationsFetchFailure(state, true)).toBe(false);
  });
});
