import { describe, expect, it } from "vitest";
import {
  isNotificationsFetchFailure,
  mergeNotificationsLoadState,
} from "./notifications-page-load";
import { resolveReloadFailureState, shouldShowSyncRetryBanner } from "./och-surface-reload";

describe("notifications page reload state", () => {
  it("successful partial fetch is not a total failure", () => {
    const state = mergeNotificationsLoadState("loaded", "rate-limited", true);
    expect(isNotificationsFetchFailure(state, true)).toBe(false);
    expect(state).toBe("loaded");
  });

  it("successful fetch after 429 clears retry banner state", () => {
    const afterSuccess = resolveReloadFailureState({
      isRateLimited: false,
      rowCount: 1,
      hadPriorSuccess: true,
    });
    expect(afterSuccess).toEqual({ loadState: "loaded", retryNotice: null });
    expect(shouldShowSyncRetryBanner(afterSuccess.loadState, 1)).toBe(false);
  });

  it("background 429 with visible rows does not show retry banner", () => {
    const failure = resolveReloadFailureState({
      isRateLimited: true,
      rowCount: 3,
      hadPriorSuccess: true,
    });
    expect(failure.loadState).toBe("loaded");
    expect(shouldShowSyncRetryBanner(failure.loadState, 3)).toBe(false);
  });

  it("empty 429 shows one retry notice", () => {
    const failure = resolveReloadFailureState({
      isRateLimited: true,
      rowCount: 0,
      hadPriorSuccess: false,
    });
    expect(failure.retryNotice).toBe("Still syncing. Retrying…");
    expect(shouldShowSyncRetryBanner(failure.loadState, 0)).toBe(true);
  });
});
