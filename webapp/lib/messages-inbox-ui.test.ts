import { describe, expect, it } from "vitest";
import {
  shouldRetryBookingUpdatesOnTab,
  shouldShowInboxEmpty,
  type MessagesInboxUiState,
} from "./messages-inbox-ui";

const base: MessagesInboxUiState = {
  authHydrating: false,
  authReady: true,
  threadsLoading: false,
  bookingUpdatesLoading: false,
  initialLoadDone: true,
  bookingUpdatesLoaded: true,
  inboxTab: "messages",
  threadCount: 0,
  bookingUpdateCount: 0,
};

describe("messages inbox UI gating", () => {
  it("does not show empty state before auth is ready", () => {
    expect(
      shouldShowInboxEmpty({
        ...base,
        authReady: false,
        authHydrating: true,
        threadCount: 0,
        initialLoadDone: true,
      }),
    ).toBe(false);
    expect(
      shouldShowInboxEmpty({
        ...base,
        authReady: false,
        initialLoadDone: true,
        threadCount: 0,
      }),
    ).toBe(false);
  });

  it("does not show messages empty while threads are loading", () => {
    expect(
      shouldShowInboxEmpty({
        ...base,
        inboxTab: "messages",
        threadsLoading: true,
        threadCount: 0,
      }),
    ).toBe(false);
  });

  it("does not show booking empty before bookingUpdatesLoaded", () => {
    expect(
      shouldShowInboxEmpty({
        ...base,
        inboxTab: "booking",
        bookingUpdatesLoaded: false,
        bookingUpdateCount: 0,
      }),
    ).toBe(false);
  });

  it("booking updates retry on tab activation after initial failed fetch", () => {
    expect(
      shouldRetryBookingUpdatesOnTab({
        authReady: true,
        token: "tok",
        currentUserId: "user-a",
        bookingUpdatesLoaded: false,
        bookingUpdatesLoading: false,
      }),
    ).toBe(true);
    expect(
      shouldRetryBookingUpdatesOnTab({
        authReady: true,
        token: "tok",
        currentUserId: "user-a",
        bookingUpdatesLoaded: true,
        bookingUpdatesLoading: false,
      }),
    ).toBe(false);
  });
});
