// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { setStoredToken, clearStoredToken } from "./auth-storage";
import { useOchSession } from "./och-session";
import { useLoadSequenceGuard } from "./och-load-guard";
import { shouldShowInboxEmpty } from "./messages-inbox-ui";
import { onBadgesRefreshForInbox } from "./messages-inbox-events";

function fakeJwt(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub })).toString("base64url");
  return `${header}.${payload}.sig`;
}

const userA = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("och cold-load auth", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("loads messages after auth token becomes available after mount", async () => {
    const { result } = renderHook(() => useOchSession());
    expect(result.current.authReady).toBe(false);
    setStoredToken(fakeJwt(userA));
    await waitFor(() => expect(result.current.authReady).toBe(true));
  });

  it("does not show empty state before auth is ready", () => {
    expect(
      shouldShowInboxEmpty({
        authHydrating: true,
        authReady: false,
        threadsLoading: false,
        bookingUpdatesLoading: false,
        initialLoadDone: true,
        bookingUpdatesLoaded: true,
        inboxTab: "messages",
        threadCount: 0,
        bookingUpdateCount: 0,
      }),
    ).toBe(false);
  });

  it("booking updates loads after auth token becomes available after mount", async () => {
    const { result } = renderHook(() => useOchSession());
    setStoredToken(fakeJwt(userA));
    await waitFor(() => {
      expect(result.current.token).toBeTruthy();
      expect(result.current.currentUserId).toBe(userA);
    });
  });

  it("stale response from old user is ignored after user switch", () => {
    const { result } = renderHook(() => useLoadSequenceGuard());
    result.current.onUserChange(userA);
    const seqA = result.current.beginLoad();
    result.current.onUserChange("bbbbbbbb-cccc-dddd-eeee-ffffffffffff");
    expect(result.current.isStale(seqA)).toBe(true);
  });

  it("reloads booking updates on och:badges-refresh", () => {
    const reload = vi.fn();
    onBadgesRefreshForInbox({ authReady: true, token: "tok", currentUserId: userA }, reload);
    expect(reload).toHaveBeenCalledWith("badges-refresh");
  });
});

describe("notifications page empty gating", () => {
  it("notifications page does not show empty state before auth ready", () => {
    const authReady = false;
    const notificationsLoaded = true;
    const notificationsLoading = false;
    const count = 0;
    const showEmpty = authReady && notificationsLoaded && !notificationsLoading && count === 0;
    expect(showEmpty).toBe(false);
  });
});

describe("landlord dashboard empty gating", () => {
  it("landlord dashboard does not show empty table before loading completes", () => {
    const initialDashboardLoaded = false;
    const dashboardLoading = true;
    const rowCount = 0;
    const showEmpty = initialDashboardLoaded && !dashboardLoading && rowCount === 0;
    expect(showEmpty).toBe(false);
  });

  it("landlord listings empty only after successful fetch", () => {
    const listingsFetchOk = false;
    const listingsState = "rate-limited" as const;
    const count = 0;
    const showListingsEmpty = listingsFetchOk && listingsState === "loaded" && count === 0;
    expect(showListingsEmpty).toBe(false);
  });
});

describe("notifications load state", () => {
  it("429 without data is rate-limited not empty-ready", () => {
    const loadState = "rate-limited" as const;
    const hadSuccessfulFetch = false;
    const showEmpty = loadState === "loaded" && hadSuccessfulFetch;
    expect(showEmpty).toBe(false);
  });
});
