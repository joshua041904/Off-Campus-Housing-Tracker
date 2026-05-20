import { listNotifications, type NotificationItem } from "./api";
import { isBookingNotificationItem } from "./booking-notification-projection";
import {
  applyBookingContextReadSyncToItems,
  collapseLandlordBookingNotificationsByBookingId,
  dedupeNotificationFeed,
} from "./notification-dedupe-feed";
import { logFetchFailureDebug } from "./och-fetch-errors";
import type { SurfaceLoadState } from "./och-page-load";
import { logPerfDebug, ochPerfMark, ochPerfMeasure } from "./och-perf";
import { surfaceStateFromSettled } from "./och-single-flight";

export type NotificationsPageLoadResult = {
  items: NotificationItem[];
  generalState: SurfaceLoadState;
  bookingState: SurfaceLoadState;
  hadSuccessfulFetch: boolean;
};

export async function loadNotificationsPageData(
  token: string,
  recipientUserId: string,
  reason: string,
): Promise<NotificationsPageLoadResult> {
  ochPerfMark("och:notifications:start");
  logPerfDebug("notifications:load-start", { reason });

  const feedResult = await Promise.allSettled([listNotifications(token, 100, { scope: "user" })]);

  const chunks: NotificationItem[] = [];
  let hadSuccessfulFetch = false;

  if (feedResult[0].status === "fulfilled") {
    chunks.push(...feedResult[0].value);
    hadSuccessfulFetch = true;
  } else {
    logFetchFailureDebug("notifications:feed", feedResult[0].reason);
  }

  const generalState: SurfaceLoadState =
    feedResult[0].status === "fulfilled"
      ? "loaded"
      : surfaceStateFromSettled("rejected", feedResult[0].reason);
  const bookingState: SurfaceLoadState = generalState;

  const deduped = dedupeNotificationFeed(chunks, {
    recipientUserId: recipientUserId || undefined,
  });
  const bookingItems: NotificationItem[] = [];
  const nonBooking: NotificationItem[] = [];
  for (const item of deduped) {
    if (isBookingNotificationItem(item)) bookingItems.push(item);
    else nonBooking.push(item);
  }
  const items = applyBookingContextReadSyncToItems(
    [...collapseLandlordBookingNotificationsByBookingId(bookingItems), ...nonBooking],
  ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  ochPerfMark("och:notifications:loaded");
  ochPerfMeasure("och:notifications:load", "och:notifications:start", "och:notifications:loaded");
  logPerfDebug("notifications:load-done", {
    reason,
    count: items.length,
    generalState,
    bookingState,
    hadSuccessfulFetch,
  });

  return { items, generalState, bookingState, hadSuccessfulFetch };
}

export function mergeNotificationsLoadState(
  generalState: SurfaceLoadState,
  bookingState: SurfaceLoadState,
  hadSuccessfulFetch: boolean,
): SurfaceLoadState {
  if (hadSuccessfulFetch) {
    if (generalState === "rate-limited" || bookingState === "rate-limited") return "loaded";
    return "loaded";
  }
  if (generalState === "rate-limited" || bookingState === "rate-limited") return "rate-limited";
  if (generalState === "error" || bookingState === "error") return "error";
  return "loaded";
}

export function isNotificationsFetchFailure(state: SurfaceLoadState, hadSuccessfulFetch: boolean): boolean {
  return !hadSuccessfulFetch && (state === "error" || state === "rate-limited");
}
