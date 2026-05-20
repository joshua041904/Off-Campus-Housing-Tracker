import type { MessagingThreadSummary, NotificationItem, TenantBookingSummary } from "./api";
import {
  listMessagingThreads,
  listMyBookings,
  listNotifications,
} from "./api";
import {
  bookingProjectionsToThreadSummaries,
  mergeBookingNotificationsWithFallback,
  projectBookingNotificationRows,
  type BookingUpdateProjection,
} from "./booking-notification-projection";
import { applyBookingContextReadSyncToItems } from "./notification-dedupe-feed";
import { logMessagesDebug } from "./messages-debug";
import { classifyFetchFailure, logFetchFailureDebug, userSafeLoadMessage } from "./och-fetch-errors";

export type InboxLoadReason =
  | "auth-ready"
  | "visibility-retry"
  | "booking-tab"
  | "badges-refresh"
  | "manual-refresh";

export type ThreadsLoadResult = {
  threads: MessagingThreadSummary[];
  serverBookingUpdates: MessagingThreadSummary[];
  error: string | null;
};

export type BookingUpdatesLoadResult = {
  bookingUpdates: MessagingThreadSummary[];
  projectionByThreadId: Map<string, BookingUpdateProjection>;
  warnings: string[];
};

export async function loadMessagingThreadsForUser(
  token: string,
  reason: InboxLoadReason,
): Promise<ThreadsLoadResult> {
  logMessagesDebug("threads:request", { reason });
  try {
    const { threads, bookingUpdates } = await listMessagingThreads(token);
    logMessagesDebug("threads:ok", { reason, threadCount: threads.length, serverBookingCount: bookingUpdates.length });
    return { threads, serverBookingUpdates: bookingUpdates, error: null };
  } catch (e: unknown) {
    logFetchFailureDebug("messages:threads", e);
    const message = userSafeLoadMessage("messages", classifyFetchFailure(e));
    logMessagesDebug("threads:error", { reason, message });
    return { threads: [], serverBookingUpdates: [], error: message };
  }
}

export async function loadBookingUpdatesForUser(
  token: string,
  currentUserId: string,
  serverBookingUpdates: MessagingThreadSummary[],
  reason: InboxLoadReason,
): Promise<BookingUpdatesLoadResult> {
  const warnings: string[] = [];
  logMessagesDebug("booking-updates:request", { reason, userId: currentUserId });

  const [notifResult, bookingsResult] = await Promise.allSettled([
    listNotifications(token, 100, { category: "booking", scope: "all" }),
    listMyBookings(token, { role: "either" }),
  ]);

  let notifBooking: NotificationItem[] = [];
  if (notifResult.status === "fulfilled") {
    notifBooking = notifResult.value;
    logMessagesDebug("booking-notifications:ok", { reason, count: notifBooking.length });
  } else {
    const message =
      notifResult.reason instanceof Error ? notifResult.reason.message : "booking notifications unavailable";
    warnings.push(message);
    logMessagesDebug("booking-notifications:error", { reason, message });
  }

  let mineBookings: TenantBookingSummary[] = [];
  if (bookingsResult.status === "fulfilled") {
    mineBookings = bookingsResult.value;
    logMessagesDebug("booking-fallback:ok", { reason, count: mineBookings.length });
  } else {
    logFetchFailureDebug("messages:bookings", bookingsResult.reason);
    const message = userSafeLoadMessage("bookings", classifyFetchFailure(bookingsResult.reason));
    warnings.push(message);
    logMessagesDebug("booking-fallback:error", { reason, message });
  }

  const mergedBookingNotifs = applyBookingContextReadSyncToItems(
    mergeBookingNotificationsWithFallback(notifBooking, mineBookings, {
      currentUserId,
    }),
  );
  const projections = projectBookingNotificationRows(mergedBookingNotifs, {
    currentUserId,
    collapseByBookingId: true,
  });
  const projectionByThreadId = new Map<string, BookingUpdateProjection>();
  for (const row of projections) {
    if (row.notificationId) projectionByThreadId.set(`notif:${row.notificationId}`, row);
  }
  const fromNotifs = bookingProjectionsToThreadSummaries(projections);
  const merged = new Map<string, MessagingThreadSummary>();
  for (const row of [...fromNotifs, ...serverBookingUpdates]) {
    merged.set(row.id, row);
  }
  const bookingUpdates = Array.from(merged.values()).sort(
    (x, y) => new Date(y.lastAt || 0).getTime() - new Date(x.lastAt || 0).getTime(),
  );

  logMessagesDebug("booking-updates:projection", {
    reason,
    projectionCount: projections.length,
    rowCount: bookingUpdates.length,
  });

  return { bookingUpdates, projectionByThreadId, warnings };
}

/** In-memory guard: never reuse empty inbox keyed only by anonymous session. */
const lastLoadedUserId: { current: string | null } = { current: null };

export function shouldClearInboxForAuthChange(nextUserId: string | null): boolean {
  if (!nextUserId) return true;
  if (lastLoadedUserId.current && lastLoadedUserId.current !== nextUserId) return true;
  return false;
}

export function markInboxLoadedForUser(userId: string): void {
  lastLoadedUserId.current = userId;
}
