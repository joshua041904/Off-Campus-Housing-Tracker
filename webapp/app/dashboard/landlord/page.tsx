"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Nav } from "@/components/Nav";
import { PageAuthLoading, TableRowsSkeleton } from "@/components/ui/DashboardSkeleton";
import { SyncStatusBanner } from "@/components/ui/SyncStatusBanner";
import { getStoredEmail } from "@/lib/auth-storage";
import { deleteMyListing, type NotificationItem, type TenantBookingSummary } from "@/lib/api";
import { loadLandlordDashboardData, type LandlordListingRow } from "@/lib/landlord-dashboard-load";
import { useLoadSequenceGuard, useDashboardReloadEvents } from "@/lib/och-load-guard";
import type { SurfaceLoadState } from "@/lib/och-page-load";
import { shouldShowDataEmpty, shouldShowLoadingSkeleton } from "@/lib/och-page-load";
import { resolveReloadFailureState } from "@/lib/och-surface-reload";
import { is429Error } from "@/lib/och-fetch-errors";
import { useOchSession } from "@/lib/och-session";
import {
  applyBookingNotificationReadDetail,
  landlordDashboardActionLabel,
  landlordDashboardBookingStatus,
  landlordDashboardCardTitle,
  landlordDashboardEventLabel,
  openBookingNotificationFromProjection,
  projectLandlordDashboardBookingRows,
  type BookingUpdateProjection,
} from "@/lib/booking-notification-projection";
import {
  classifyNotification,
  notificationBelongsToSurface,
  parseNotificationPayloadDeep,
} from "@/lib/notification-booking";
import { applyBookingContextReadSyncToItems, dedupeNotificationFeed } from "@/lib/notification-dedupe-feed";
import { getNotificationUnreadCount } from "@/lib/api";

export default function LandlordDashboardPage() {
  const router = useRouter();
  const { token, currentUserId, authLoading, authReady } = useOchSession();
  const [email, setEmail] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [bookingNotificationsLoading, setBookingNotificationsLoading] = useState(false);
  const [initialDashboardLoaded, setInitialDashboardLoaded] = useState(false);
  const [listingsState, setListingsState] = useState<SurfaceLoadState>("idle");
  const [notificationsState, setNotificationsState] = useState<SurfaceLoadState>("idle");
  const [listingsFetchOk, setListingsFetchOk] = useState(false);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const requestSeqRef = useRef(0);
  const lastGoodListingsRef = useRef<LandlordListingRow[]>([]);
  const lastGoodItemsRef = useRef<NotificationItem[]>([]);
  const lastGoodBookingsRef = useRef<TenantBookingSummary[]>([]);
  const reloadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [myListings, setMyListings] = useState<LandlordListingRow[]>([]);
  const { beginLoad, isStale, onUserChange } = useLoadSequenceGuard();
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; title: string } | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** Pending bookings as host — backs the notification table when notification rows are missing or filtered out. */
  const [landlordMineBookings, setLandlordMineBookings] = useState<TenantBookingSummary[]>([]);

  useEffect(() => {
    setEmail(getStoredEmail());
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!token || !currentUserId) {
      if (typeof window !== "undefined") window.location.replace("/login");
      return;
    }
    onUserChange(currentUserId);
  }, [authLoading, token, currentUserId, onUserChange]);

  const applySurfaceFailure = useCallback(
    (
      surfaceState: SurfaceLoadState,
      rowCount: number,
      hadPriorRows: boolean,
    ): SurfaceLoadState => {
      if (surfaceState === "loaded" || rowCount > 0 || hadPriorRows) return "loaded";
      return resolveReloadFailureState({
        isRateLimited: surfaceState === "rate-limited",
        rowCount: 0,
        hadPriorSuccess: hadPriorRows,
      }).loadState;
    },
    [],
  );

  const loadDashboard = useCallback(
    async (reason: string, opts?: { background?: boolean }) => {
      if (!token || !currentUserId) return;
      if (inFlightRef.current) return inFlightRef.current;

      const seq = ++requestSeqRef.current;
      const background = Boolean(opts?.background);
      const hadListings = lastGoodListingsRef.current.length > 0;
      const hadNotifications = lastGoodItemsRef.current.length > 0;

      if (!background && !hadListings) setListingsState("initial-loading");
      if (!background && !hadNotifications) setNotificationsState("initial-loading");
      if (!background) {
        setListingsLoading(true);
        setBookingNotificationsLoading(true);
      }

      const task = (async () => {
        const guardSeq = beginLoad();
        try {
          const result = await loadLandlordDashboardData(token, currentUserId, reason);
          if (isStale(guardSeq) || seq !== requestSeqRef.current) return;

          if (result.listingsFetchOk) {
            lastGoodListingsRef.current = result.myListings;
            setMyListings(result.myListings);
            setListingsState("loaded");
            setListingsFetchOk(true);
          } else {
            setMyListings(lastGoodListingsRef.current);
            setListingsState(applySurfaceFailure(result.listingsState, result.myListings.length, hadListings));
            setListingsFetchOk(lastGoodListingsRef.current.length > 0);
          }

          if (result.notificationsFetchOk) {
            lastGoodItemsRef.current = result.items;
            setItems(result.items);
            setNotificationsState("loaded");
          } else {
            setItems(lastGoodItemsRef.current);
            setNotificationsState(
              applySurfaceFailure(result.notificationsState, lastGoodItemsRef.current.length, hadNotifications),
            );
          }

          if (result.bookingsState === "loaded" || result.landlordMineBookings.length > 0) {
            lastGoodBookingsRef.current = result.landlordMineBookings;
            setLandlordMineBookings(result.landlordMineBookings);
          } else if (lastGoodBookingsRef.current.length > 0) {
            setLandlordMineBookings(lastGoodBookingsRef.current);
          } else {
            setLandlordMineBookings(result.landlordMineBookings);
          }
        } catch (error) {
          if (isStale(guardSeq) || seq !== requestSeqRef.current) return;
          const rateLimited = is429Error(error);
          setMyListings(lastGoodListingsRef.current);
          setItems(lastGoodItemsRef.current);
          setLandlordMineBookings(lastGoodBookingsRef.current);
          setListingsState(
            applySurfaceFailure(rateLimited ? "rate-limited" : "error", lastGoodListingsRef.current.length, hadListings),
          );
          setNotificationsState(
            applySurfaceFailure(
              rateLimited ? "rate-limited" : "error",
              lastGoodItemsRef.current.length,
              hadNotifications,
            ),
          );
          setListingsFetchOk(lastGoodListingsRef.current.length > 0);
        } finally {
          if (seq === requestSeqRef.current) {
            inFlightRef.current = null;
          }
          setListingsLoading(false);
          setBookingNotificationsLoading(false);
          setInitialDashboardLoaded(true);
        }
      })();

      inFlightRef.current = task;
      return task;
    },
    [token, currentUserId, beginLoad, isStale, applySurfaceFailure],
  );

  const scheduleDashboardReload = useCallback(
    (reason: string) => {
      if (reloadDebounceRef.current) clearTimeout(reloadDebounceRef.current);
      reloadDebounceRef.current = setTimeout(() => {
        reloadDebounceRef.current = null;
        void loadDashboard(reason, { background: true });
      }, 250);
    },
    [loadDashboard],
  );

  useEffect(
    () => () => {
      if (reloadDebounceRef.current) clearTimeout(reloadDebounceRef.current);
    },
    [],
  );

  useEffect(() => {
    if (authLoading) return;
    if (!authReady || !token || !currentUserId) return;
    void loadDashboard("auth-ready");
  }, [authLoading, authReady, token, currentUserId, loadDashboard]);

  useDashboardReloadEvents(authReady && Boolean(token), scheduleDashboardReload);

  const listingIdToTitle = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of myListings) {
      m.set(l.id, l.title);
    }
    return m;
  }, [myListings]);
  const landlordListingIds = useMemo(() => new Set(myListings.map((listing) => listing.id.toLowerCase())), [myListings]);

  const currentBookingStatusById = useMemo(() => {
    const m = new Map<string, string>();
    for (const booking of landlordMineBookings) {
      const bookingId = String(booking.booking_id || booking.id || "").trim().toLowerCase();
      if (!bookingId) continue;
      m.set(bookingId, String(booking.status || "").trim().toUpperCase());
    }
    return m;
  }, [landlordMineBookings]);

  const showListingsEmpty =
    initialDashboardLoaded && listingsFetchOk && shouldShowDataEmpty(listingsState, myListings.length);

  const bookingProjections = useMemo((): BookingUpdateProjection[] => {
    if (!currentUserId) return [];
    return projectLandlordDashboardBookingRows(items, {
      currentUserId,
      landlordMineBookings,
      landlordListingIds,
      listingIdToTitle,
    });
  }, [
    currentUserId,
    items,
    landlordListingIds,
    landlordMineBookings,
    listingIdToTitle,
  ]);

  const communityRows = useMemo(
    () =>
      items.filter(
        (item) =>
          notificationBelongsToSurface(item, "landlord", { landlordListingIds }) &&
          classifyNotification(item, { landlordListingIds }).category === "community",
      ),
    [items, landlordListingIds],
  );
  const landlordUnreadCount = useMemo(
    () =>
      bookingProjections.filter((row) => row.isUnread).length +
      communityRows.filter((item) => !item.read_at).length,
    [bookingProjections, communityRows],
  );

  const dashboardLoading =
    authLoading ||
    ((listingsLoading || shouldShowLoadingSkeleton(listingsState, myListings.length)) &&
      myListings.length === 0) ||
    ((bookingNotificationsLoading || shouldShowLoadingSkeleton(notificationsState, items.length)) &&
      items.length === 0 &&
      bookingProjections.length === 0 &&
      communityRows.length === 0);

  const openLandlordBookingProjection = useCallback(
    (projection: BookingUpdateProjection) => {
      if (!projection.href) return;
      if (!token) {
        router.push(projection.href);
        return;
      }
      void openBookingNotificationFromProjection(token, projection, {
        onLocalRead: (readAt, result) => {
          const notificationIds =
            result.notification_ids.length > 0
              ? result.notification_ids
              : projection.notificationId
                ? [projection.notificationId]
                : [];
          setItems((prev) =>
            applyBookingContextReadSyncToItems(
              applyBookingNotificationReadDetail(prev, {
                bookingId: projection.bookingId,
                notificationIds,
                readAt,
              }),
            ),
          );
        },
        navigate: (href) => router.push(href),
      });
    },
    [router, token],
  );

  const handleRealtimeNotification = useCallback((payload: Record<string, unknown>) => {
    const eventType = String(payload.event_type || payload.event || "notification");
    const next: NotificationItem = {
      id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      event_type: eventType,
      channel: "push",
      status: "pending",
      payload,
      created_at: new Date().toISOString(),
    };
    setItems((prev) =>
      dedupeNotificationFeed([next, ...prev], { recipientUserId: currentUserId || undefined }),
    );
  }, [currentUserId]);

  useEffect(() => {
    if (!token) return;
    const fn = (ev: Event) => {
      const ce = ev as CustomEvent<{ payload?: Record<string, unknown> }>;
      const payload = ce.detail?.payload;
      if (!payload || typeof payload !== "object") return;
      handleRealtimeNotification(payload);
    };
    window.addEventListener("och:live-notification", fn as EventListener);
    return () => window.removeEventListener("och:live-notification", fn as EventListener);
  }, [token, handleRealtimeNotification]);

  useEffect(() => {
    const onRead = (event: Event) => {
      const custom = event as CustomEvent<{
        notificationIds?: string[];
        bookingId?: string;
        readAt?: string;
      }>;
      const readAt = String(custom.detail?.readAt || new Date().toISOString());
      const bookingId = String(custom.detail?.bookingId || "").trim().toLowerCase();
      if (!bookingId && !(custom.detail?.notificationIds?.length ?? 0)) return;
      setItems((prev) =>
        applyBookingContextReadSyncToItems(
          applyBookingNotificationReadDetail(prev, {
            notificationIds: custom.detail?.notificationIds,
            bookingId: bookingId || undefined,
            readAt,
          }),
        ),
      );
    };
    window.addEventListener("och:notifications-read", onRead as EventListener);
    return () => window.removeEventListener("och:notifications-read", onRead as EventListener);
  }, []);

  useEffect(() => {
    if (!token) {
      setUnreadCount(landlordUnreadCount);
      return;
    }
    let cancelled = false;
    void getNotificationUnreadCount(token, { scope: "landlord" })
      .then((count) => {
        if (!cancelled) setUnreadCount(count);
      })
      .catch(() => {
        if (!cancelled) setUnreadCount(landlordUnreadCount);
      });
    return () => {
      cancelled = true;
    };
  }, [token, landlordUnreadCount, items.length]);

  async function confirmDeleteListing() {
    if (!token || !deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteMyListing(token, deleteTarget.id);
      setMyListings((prev) => prev.filter((x) => x.id !== deleteTarget.id));
      setDeleteTarget(null);
      router.refresh();
    } catch (e: unknown) {
      setDeleteError(e instanceof Error ? e.message : "Could not remove listing");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-indigo-50/40 text-slate-900" data-testid="landlord-dashboard-root">
      <Nav email={email} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Landlord Dashboard</h1>
          <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm" data-testid="landlord-notification-bell">
            <span className="mr-2">🔔</span>
            <span className="font-semibold">{unreadCount}</span>
          </div>
        </div>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-medium">Your listings</h2>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/dashboard/landlord/listings/new"
                className="rounded-md bg-teal-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700"
                data-testid="landlord-create-listing-link"
              >
                Create listing
              </Link>
              <Link href="/listings" className="text-sm font-medium text-teal-700 hover:underline">
                Browse marketplace
              </Link>
            </div>
          </div>
          <p className="mt-1 text-sm text-slate-600">Listings you publish as this landlord account.</p>
          {dashboardLoading && !listingsFetchOk ? (
            <div className="mt-3" data-testid="landlord-listings-skeleton">
              <TableRowsSkeleton rows={2} />
            </div>
          ) : null}
          <SyncStatusBanner
            state={listingsState}
            rowCount={myListings.length}
            onRetry={() => void loadDashboard("manual-retry")}
          />
          {showListingsEmpty ? (
            <p className="mt-3 text-sm text-slate-500" data-testid="landlord-listings-empty">
              No listings yet — use <span className="font-medium">Create listing</span> to add photos, address, and rent, then publish or save a draft.
            </p>
          ) : myListings.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {myListings.slice(0, 12).map((l) => (
                <li
                  key={l.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/dashboard/landlord/listings/${encodeURIComponent(l.id)}`}
                      className="block truncate font-medium text-slate-900 hover:text-teal-800 hover:underline"
                    >
                      {l.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-slate-600">
                      {l.residence_type ? <span className="capitalize">{String(l.residence_type).replace(/_/g, " ")} · </span> : null}
                      {l.square_feet != null ? <span>{l.square_feet.toLocaleString()} sq ft · </span> : null}
                      {l.price_usd_monthly != null ? (
                        <span>${Number(l.price_usd_monthly).toLocaleString()}/mo · </span>
                      ) : null}
                      <span className="font-semibold text-amber-800">
                        {Math.max(0, Math.floor(Number(l.watch_count ?? 0)))} watchers
                      </span>
                    </p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      <Link
                        href={`/dashboard/landlord/listings/${encodeURIComponent(l.id)}`}
                        className="inline-flex items-center rounded-md bg-teal-800 px-2 py-1 text-xs font-medium text-white hover:bg-teal-700"
                        data-testid={`landlord-edit-${l.id}`}
                      >
                        Edit
                      </Link>
                      <button
                        type="button"
                        className="inline-flex items-center rounded-md border border-rose-300 bg-white px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-50"
                        data-testid={`landlord-delete-${l.id}`}
                        onClick={() => setDeleteTarget({ id: l.id, title: l.title })}
                      >
                        Remove…
                      </button>
                      <Link
                        href={`/listings/${encodeURIComponent(l.id)}`}
                        className="inline-flex items-center text-xs text-teal-700 hover:underline"
                      >
                        View public listing
                      </Link>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs text-slate-600 ring-1 ring-slate-200">
                    {l.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {deleteTarget ? (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-lg">
              <h2 className="text-lg font-semibold text-slate-900">Remove from marketplace?</h2>
              <p className="mt-2 text-sm text-slate-600">
                <span className="font-medium">{deleteTarget.title}</span> will be hidden from search (soft delete /
                archived).
              </p>
              {deleteError ? <p className="mt-2 text-sm text-red-600">{deleteError}</p> : null}
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-300 px-3 py-1.5 text-sm"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleteBusy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="rounded-md bg-rose-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-800 disabled:opacity-50"
                  disabled={deleteBusy}
                  onClick={() => void confirmDeleteListing()}
                >
                  {deleteBusy ? "Removing…" : "Remove listing"}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-medium">Recent Notifications</h2>
          <p className="mt-1 text-sm text-slate-600">New booking requests and platform events routed to your landlord account.</p>
          {authLoading ? <PageAuthLoading label="Loading your landlord dashboard…" /> : null}
          <SyncStatusBanner
            state={notificationsState}
            rowCount={items.length + bookingProjections.length + communityRows.length}
            onRetry={() => void loadDashboard("manual-retry")}
          />
          {dashboardLoading ? (
            <div className="mt-4" data-testid="landlord-booking-skeleton">
              <TableRowsSkeleton rows={5} />
            </div>
          ) : null}
          {!authLoading &&
          initialDashboardLoaded &&
          !dashboardLoading &&
          notificationsState === "loaded" &&
          bookingProjections.length === 0 &&
          communityRows.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">No notifications yet.</p>
          ) : null}
          <div className="mt-4 space-y-3">
            {communityRows.slice(0, 8).map((item) => {
              const p = parseNotificationPayloadDeep(item);
              const baseHref =
                String(p.deep_link || "").trim() || `/community/${encodeURIComponent(String(p.post_id || ""))}`;
              const hrefWithNid =
                baseHref + (baseHref.includes("?") ? "&" : "?") + "nid=" + encodeURIComponent(item.id);
              const actor = String(p.actor_display_name || p.actor_username || "Someone").trim();
              const snippet = String(p.snippet || "").trim();
              const title = String(p.post_title || "Community post").trim();
              const isReply = item.event_type === "community.reply.notification";
              return (
                <article key={item.id} className="rounded-lg border border-teal-100 bg-teal-50/40 p-4">
                  <p className="text-sm font-semibold text-slate-900">
                    {isReply ? "New reply to your comment" : "New comment on your post"}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    <span className="font-medium">{actor}</span> on “{title.slice(0, 80)}
                    {title.length > 80 ? "…" : ""}”
                  </p>
                  {snippet ? <p className="mt-1 line-clamp-2 text-xs text-slate-700">{snippet}</p> : null}
                  <p className="text-xs text-slate-500">{new Date(item.created_at).toLocaleString()}</p>
                  {token ? (
                    <Link
                      href={hrefWithNid.startsWith("/") ? hrefWithNid : `/${hrefWithNid}`}
                      className="mt-2 inline-block text-sm font-medium text-teal-800 hover:underline"
                    >
                      Open thread
                    </Link>
                  ) : null}
                </article>
              );
            })}
            {bookingProjections.slice(0, 8).map((projection) => {
              const bookingStatus = landlordDashboardBookingStatus(projection, currentBookingStatusById);
              const cardTitle = landlordDashboardCardTitle(projection, bookingStatus);
              const actionLabel = landlordDashboardActionLabel(bookingStatus);
              return (
                <article
                  key={projection.notificationId || projection.bookingId}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-4"
                  data-testid={`landlord-booking-card-${projection.bookingId}`}
                >
                  <p className="text-sm font-semibold text-slate-900">{cardTitle}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{projection.statusLabel}</p>
                  <p className="mt-1 text-xs text-slate-600">
                    Listing:{" "}
                    {projection.listingId ? (
                      <Link
                        href={`/listings/${encodeURIComponent(projection.listingId)}`}
                        className="font-medium text-teal-800 hover:underline"
                      >
                        {projection.listingTitle}
                      </Link>
                    ) : (
                      projection.listingTitle
                    )}
                  </p>
                  <p className="text-xs text-slate-600">
                    Renter: <span className="font-medium text-slate-800">{projection.counterparty}</span>
                  </p>
                  <p className="text-xs text-slate-500">{new Date(projection.createdAt).toLocaleString()}</p>
                  <p className="text-xs text-slate-600">
                    Read: <span className="font-medium">{projection.isUnread ? "Unread" : "Read"}</span>
                    {" "}
                    · Booking: <span className="font-medium">{bookingStatus}</span>
                  </p>
                  {projection.href ? (
                    <Link
                      href={projection.href}
                      className="mt-2 inline-block text-sm font-medium text-blue-700 hover:underline"
                      onClick={(event) => {
                        event.preventDefault();
                        openLandlordBookingProjection(projection);
                      }}
                    >
                      {actionLabel}
                    </Link>
                  ) : null}
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-medium">Notification Table View</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="landlord-booking-notification-table">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3">Event</th>
                  <th className="py-2 pr-3">Listing</th>
                  <th className="py-2 pr-3">Renter</th>
                  <th className="py-2 pr-3">Time</th>
                  <th className="py-2 pr-3">Read</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3">Action</th>
                </tr>
              </thead>
              <tbody>
                {bookingProjections.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-4 text-sm text-slate-500">
                      No booking request notifications yet. When a renter books your listing, a row with type{" "}
                      <span className="font-mono text-xs">booking.created</span> appears here (separate from community
                      cards above). If you expected a row, confirm booking-service can reach listings + notification HTTP
                      and that this account is the listing landlord.
                    </td>
                  </tr>
                ) : null}
                {bookingProjections.map((projection) => {
                  const bookingStatus = landlordDashboardBookingStatus(projection, currentBookingStatusById);
                  const eventLabel = landlordDashboardEventLabel(projection, bookingStatus);
                  const actionLabel = landlordDashboardActionLabel(bookingStatus);
                  const href = projection.href || "";
                  return (
                    <tr
                      key={`${projection.notificationId || projection.bookingId}-${projection.notification.event_type}-row`}
                      className="border-b border-slate-100"
                      data-testid={`landlord-booking-row-${projection.bookingId}`}
                    >
                      <td className="py-2 pr-3 text-sm text-slate-700">{eventLabel}</td>
                      <td className="max-w-[10rem] truncate py-2 pr-3" title={projection.listingId || undefined}>
                        {projection.listingTitle}
                      </td>
                      <td className="max-w-[8rem] truncate py-2 pr-3" title={projection.counterparty}>
                        {projection.counterparty}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3 text-xs text-slate-600">
                        {new Date(projection.createdAt).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3">{projection.isUnread ? "Unread" : "Read"}</td>
                      <td className="py-2 pr-3 text-xs">{bookingStatus}</td>
                      <td className="py-2 pr-3">
                        {href ? (
                          <Link
                            href={href}
                            className="font-medium text-teal-800 hover:underline"
                            onClick={(event) => {
                              event.preventDefault();
                              openLandlordBookingProjection(projection);
                            }}
                          >
                            {actionLabel}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
