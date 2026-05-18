import {
  listMyBookings,
  listMyListings,
  listNotifications,
  type NotificationItem,
  type TenantBookingSummary,
} from "./api";
import { isBookingNotificationItem } from "./booking-notification-projection";
import {
  applyBookingContextReadSyncToItems,
  collapseLandlordBookingNotificationsByBookingId,
  dedupeNotificationFeed,
} from "./notification-dedupe-feed";
import { prettyListingTitle } from "./listing-display";
import { logFetchFailureDebug } from "./och-fetch-errors";
import type { SurfaceLoadState } from "./och-page-load";
import { logPerfDebug, ochPerfMark, ochPerfMeasure } from "./och-perf";
import { surfaceStateFromSettled } from "./och-single-flight";

export type LandlordListingRow = {
  id: string;
  title: string;
  status: string;
  watch_count?: number;
  price_usd_monthly?: number | null;
  square_feet?: number | null;
  residence_type?: string | null;
};

export type LandlordDashboardLoadResult = {
  items: NotificationItem[];
  myListings: LandlordListingRow[];
  landlordMineBookings: TenantBookingSummary[];
  listingsState: SurfaceLoadState;
  notificationsState: SurfaceLoadState;
  bookingsState: SurfaceLoadState;
  listingsFetchOk: boolean;
  notificationsFetchOk: boolean;
};

export async function loadLandlordDashboardData(
  token: string,
  recipientUserId: string,
  reason: string,
): Promise<LandlordDashboardLoadResult> {
  ochPerfMark("och:landlord-dashboard:start");
  const loadStarted = Date.now();
  logPerfDebug("landlord:load-start", { reason });

  const [ownedListings, landlordFeed, mineBookings] = await Promise.allSettled([
    listMyListings(token),
    listNotifications(token, 200, { scope: "landlord" }),
    listMyBookings(token, { role: "landlord" }),
  ]);

  let listingsRaw: Awaited<ReturnType<typeof listMyListings>> = [];
  let landlordFeedItems: NotificationItem[] = [];
  let bookings: TenantBookingSummary[] = [];

  const listingsFetchOk = ownedListings.status === "fulfilled";
  if (listingsFetchOk) {
    listingsRaw = ownedListings.value;
  } else {
    logFetchFailureDebug("landlord:listings", ownedListings.reason);
  }

  let notificationsFetchOk = false;
  if (landlordFeed.status === "fulfilled") {
    landlordFeedItems = landlordFeed.value;
    notificationsFetchOk = true;
  } else {
    logFetchFailureDebug("landlord:notifications", landlordFeed.reason);
  }

  const bookingsFetchOk = mineBookings.status === "fulfilled";
  if (bookingsFetchOk) {
    bookings = mineBookings.value;
  } else {
    logFetchFailureDebug("landlord:bookings", mineBookings.reason);
  }

  const listingsState: SurfaceLoadState = listingsFetchOk
    ? "loaded"
    : surfaceStateFromSettled("rejected", ownedListings.reason);
  const notificationCalls = [landlordFeed];
  const notificationFailures = notificationCalls.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
  const notificationsState: SurfaceLoadState = notificationsFetchOk
    ? "loaded"
    : notificationFailures.length > 0
      ? surfaceStateFromSettled("rejected", notificationFailures[0].reason)
      : "loaded";
  const bookingsState: SurfaceLoadState = bookingsFetchOk
    ? "loaded"
    : surfaceStateFromSettled("rejected", mineBookings.reason);

  const byId = new Map<string, NotificationItem>();
  for (const x of dedupeNotificationFeed(landlordFeedItems, {
    recipientUserId: recipientUserId || undefined,
  })) {
    byId.set(String(x.id), x);
  }
  const deduped = Array.from(byId.values());
  const bookingItems: NotificationItem[] = [];
  const nonBooking: NotificationItem[] = [];
  for (const item of deduped) {
    if (isBookingNotificationItem(item)) bookingItems.push(item);
    else nonBooking.push(item);
  }
  const items = applyBookingContextReadSyncToItems(
    [...collapseLandlordBookingNotificationsByBookingId(bookingItems), ...nonBooking],
  ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const sorted = [...listingsRaw].sort(
    (a, b) => (Number(b.watch_count) || 0) - (Number(a.watch_count) || 0),
  );
  const myListings: LandlordListingRow[] = sorted.map((l) => ({
    id: l.id,
    title: prettyListingTitle(l.title),
    status: l.status,
    watch_count: l.watch_count,
    price_usd_monthly: l.price_usd_monthly ?? null,
    square_feet: l.square_feet ?? null,
    residence_type: l.residence_type ?? null,
  }));

  ochPerfMark("och:landlord-dashboard:loaded");
  ochPerfMeasure("och:landlord-dashboard:load", "och:landlord-dashboard:start", "och:landlord-dashboard:loaded");
  const timings = { total_ms: Date.now() - loadStarted };
  logPerfDebug("landlord:load-done", {
    reason,
    notificationCount: items.length,
    listingCount: myListings.length,
    listingsState,
    notificationsState,
    bookingsState,
    ...timings,
  });

  return {
    items,
    myListings,
    landlordMineBookings: bookings,
    listingsState,
    notificationsState,
    bookingsState,
    listingsFetchOk,
    notificationsFetchOk,
  };
}
