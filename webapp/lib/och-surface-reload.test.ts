import { describe, expect, it, vi } from "vitest";
import {
  notificationReloadBackoffMs,
  pickReloadStartState,
  resolveReloadFailureState,
  shouldShowSyncErrorBanner,
  shouldShowSyncRetryBanner,
} from "./och-surface-reload";

describe("resolveReloadFailureState", () => {
  it("keeps loaded when rows exist after 429", () => {
    expect(
      resolveReloadFailureState({ isRateLimited: true, rowCount: 2, hadPriorSuccess: false }),
    ).toEqual({ loadState: "loaded", retryNotice: null });
  });

  it("shows retry notice only when empty and rate-limited", () => {
    expect(
      resolveReloadFailureState({ isRateLimited: true, rowCount: 0, hadPriorSuccess: false }),
    ).toEqual({ loadState: "rate-limited", retryNotice: "Still syncing. Retrying…" });
  });

  it("clears retry after prior success even with zero rows", () => {
    expect(
      resolveReloadFailureState({ isRateLimited: true, rowCount: 0, hadPriorSuccess: true }),
    ).toEqual({ loadState: "loaded", retryNotice: null });
  });
});

describe("shouldShowSyncRetryBanner", () => {
  it("hides banner when rows are visible", () => {
    expect(shouldShowSyncRetryBanner("rate-limited", 1)).toBe(false);
    expect(shouldShowSyncRetryBanner("rate-limited", 0)).toBe(true);
  });
});

describe("notificationReloadBackoffMs", () => {
  it("uses exponential backoff with jitter cap", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(notificationReloadBackoffMs(0)).toBe(1000);
    expect(notificationReloadBackoffMs(4)).toBe(16000);
    expect(notificationReloadBackoffMs(10)).toBe(30000);
    vi.restoreAllMocks();
  });
});

describe("pickReloadStartState", () => {
  it("uses initial-loading only when there are no rows yet", () => {
    expect(pickReloadStartState({ background: false, rowCount: 0, current: "idle" })).toBe(
      "initial-loading",
    );
    expect(pickReloadStartState({ background: false, rowCount: 2, current: "loaded" })).toBe("loaded");
    expect(pickReloadStartState({ background: true, rowCount: 2, current: "loaded" })).toBe("refreshing");
  });
});

describe("banner gating", () => {
  it("never shows error banner when rows are visible", () => {
    expect(shouldShowSyncErrorBanner("error", 1)).toBe(false);
    expect(shouldShowSyncErrorBanner("error", 0)).toBe(true);
  });
});
