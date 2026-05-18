export type InboxTab = "messages" | "booking";

export type MessagesInboxUiState = {
  authHydrating: boolean;
  authReady: boolean;
  threadsLoading: boolean;
  bookingUpdatesLoading: boolean;
  initialLoadDone: boolean;
  bookingUpdatesLoaded: boolean;
  inboxTab: InboxTab;
  threadCount: number;
  bookingUpdateCount: number;
};

/** Empty inbox copy only after auth is ready and the relevant fetch finished. */
export function shouldShowInboxEmpty(state: MessagesInboxUiState): boolean {
  if (state.authHydrating || !state.authReady) return false;
  if (state.inboxTab === "messages") {
    return !state.threadsLoading && state.initialLoadDone && state.threadCount === 0;
  }
  return (
    !state.bookingUpdatesLoading &&
    state.bookingUpdatesLoaded &&
    state.bookingUpdateCount === 0
  );
}

export function shouldShowThreadsLoading(state: MessagesInboxUiState): boolean {
  return state.inboxTab === "messages" && state.threadsLoading;
}

export function shouldShowBookingUpdatesLoading(state: MessagesInboxUiState): boolean {
  return state.inboxTab === "booking" && state.bookingUpdatesLoading;
}

export function shouldRetryBookingUpdatesOnTab(state: {
  authReady: boolean;
  token: string | null;
  currentUserId: string | null;
  bookingUpdatesLoaded: boolean;
  bookingUpdatesLoading: boolean;
}): boolean {
  return Boolean(
    state.authReady &&
      state.token &&
      state.currentUserId &&
      !state.bookingUpdatesLoaded &&
      !state.bookingUpdatesLoading,
  );
}

export function shouldRunAuthReadyInboxLoad(state: {
  authReady: boolean;
  token: string | null;
  currentUserId: string | null;
}): boolean {
  return Boolean(state.authReady && state.token && state.currentUserId);
}
