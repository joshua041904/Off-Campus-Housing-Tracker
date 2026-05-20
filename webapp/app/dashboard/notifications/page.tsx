"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Nav } from "@/components/Nav";
import { PageAuthLoading, TableRowsSkeleton } from "@/components/ui/DashboardSkeleton";
import { SyncStatusBanner } from "@/components/ui/SyncStatusBanner";
import { getStoredEmail } from "@/lib/auth-storage";
import { markNotificationRead, type NotificationItem } from "@/lib/api";
import {
  classifyNotification,
  notificationBelongsToSurface,
  notificationHrefForSurface,
  notificationTitleForSurface,
} from "@/lib/notification-booking";
import { applyBookingContextReadSyncToItems, dedupeNotificationFeed } from "@/lib/notification-dedupe-feed";
import { applyBookingNotificationReadDetail } from "@/lib/booking-notification-projection";
import { markBookingNotificationContextReadAndDispatch } from "@/lib/mark-booking-notification-context-read";
import { useDashboardReloadEvents } from "@/lib/och-load-guard";
import type { LoadState } from "@/lib/och-page-load";
import { shouldShowDataEmpty, shouldShowLoadingSkeleton } from "@/lib/och-page-load";
import { useOchSession } from "@/lib/och-session";
import {
  isNotificationsFetchFailure,
  loadNotificationsPageData,
  mergeNotificationsLoadState,
  type NotificationsPageLoadResult,
} from "@/lib/notifications-page-load";
import { logPerfDebug } from "@/lib/och-perf";
import { useOchSurfaceReload } from "@/lib/och-surface-reload";
import { useNotificationsRealtime } from "@/lib/useNotifications";

async function fetchNotificationsForPage(
  token: string,
  currentUserId: string,
  reason: string,
): Promise<NotificationsPageLoadResult> {
  const result = await loadNotificationsPageData(token, currentUserId, reason);
  const mergedState = mergeNotificationsLoadState(
    result.generalState,
    result.bookingState,
    result.hadSuccessfulFetch,
  );
  if (isNotificationsFetchFailure(mergedState, result.hadSuccessfulFetch)) {
    if (mergedState === "rate-limited") {
      throw new Error("429 too many requests");
    }
    throw new Error("notifications fetch failed");
  }
  return result;
}

export default function NotificationsPage() {
  const router = useRouter();
  const { token, currentUserId, authLoading, authReady } = useOchSession();
  const [email, setEmail] = useState<string | null>(null);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const itemsRef = useRef<NotificationItem[]>([]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  const {
    loadState,
    setLoadState,
    retryNotice,
    reload: reloadNotifications,
    scheduleReload,
  } = useOchSurfaceReload<NotificationsPageLoadResult>({
    enabled: authReady && Boolean(token && currentUserId),
    logLabel: "notifications",
    getRowCount: () => itemsRef.current.length,
    fetch: async (reason) => {
      if (!token || !currentUserId) {
        throw new Error("auth required");
      }
      logPerfDebug("notifications reload", {
        reason,
        rowCount: itemsRef.current.length,
      });
      return fetchNotificationsForPage(token, currentUserId, reason);
    },
    onSuccess: (result) => {
      setItems(result.items);
      itemsRef.current = result.items;
    },
  });

  useEffect(() => {
    setEmail(getStoredEmail());
  }, []);

  useEffect(() => {
    if (authLoading) {
      setLoadState("auth-wait");
      return;
    }
    if (!token || !currentUserId) {
      if (typeof window !== "undefined") window.location.replace("/login");
    }
  }, [authLoading, token, currentUserId, setLoadState]);

  useEffect(() => {
    if (authLoading) return;
    if (!authReady || !token || !currentUserId) return;
    void reloadNotifications("auth-ready");
  }, [authLoading, authReady, token, currentUserId, reloadNotifications]);

  useDashboardReloadEvents(authReady && Boolean(token), scheduleReload);

  const onRealtime = useCallback(
    (payload: Record<string, unknown>) => {
      const eventType = String(payload.event_type || payload.event || "notification");
      const next: NotificationItem = {
        id: String(payload.notification_id || payload.nid || `live-${Date.now()}`),
        event_type: eventType,
        channel: "push",
        status: "pending",
        payload,
        created_at: new Date().toISOString(),
        dedupe_key:
          payload.dedupe_key != null && String(payload.dedupe_key).trim()
            ? String(payload.dedupe_key).trim()
            : undefined,
      };
      if (!notificationBelongsToSurface(next, "user")) return;
      setItems((prev) => {
        const merged = dedupeNotificationFeed([next, ...prev], {
          recipientUserId: currentUserId || undefined,
        }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        itemsRef.current = merged;
        return merged;
      });
      setLoadState("loaded");
    },
    [currentUserId, setLoadState],
  );

  useNotificationsRealtime(authReady ? token : null, onRealtime);

  useEffect(() => {
    const onRead = (event: Event) => {
      const custom = event as CustomEvent<{ notificationIds?: string[]; bookingId?: string; readAt?: string }>;
      const readAt = String(custom.detail?.readAt || new Date().toISOString());
      const bookingId = String(custom.detail?.bookingId || "").trim().toLowerCase();
      setItems((prev) => {
        const next = applyBookingContextReadSyncToItems(
          applyBookingNotificationReadDetail(prev, {
            notificationIds: custom.detail?.notificationIds,
            bookingId: bookingId || undefined,
            readAt,
          }),
        );
        itemsRef.current = next;
        return next;
      });
    };
    window.addEventListener("och:notifications-read", onRead as EventListener);
    return () => window.removeEventListener("och:notifications-read", onRead as EventListener);
  }, []);

  const userItems = useMemo(
    () => items.filter((item) => notificationBelongsToSurface(item, "user")),
    [items],
  );
  const unread = useMemo(() => userItems.filter((item) => !item.read_at).length, [userItems]);

  const openNotification = useCallback(
    async (item: NotificationItem, href: string) => {
      if (!token) {
        router.push(href);
        return;
      }
      const classification = classifyNotification(item);
      const nextReadAt = new Date().toISOString();
      let readDetail = {
        notificationIds: item.id ? [item.id] : [],
        bookingId: classification.bookingId || undefined,
        readAt: nextReadAt,
      };
      try {
        if (classification.bookingId) {
          const result = await markBookingNotificationContextReadAndDispatch(token, {
            bookingId: classification.bookingId,
            notificationId: item.id,
          });
          readDetail = {
            notificationIds: result.notification_ids,
            bookingId: result.booking_id,
            readAt: result.read_at,
          };
        } else if (item.id) {
          await markNotificationRead(token, item.id);
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("och:notifications-read", { detail: readDetail }));
            window.dispatchEvent(new Event("och:badges-refresh"));
          }
        }
      } catch {
        /* booking detail page retries context mark-read */
      } finally {
        setItems((prev) => {
          const next = applyBookingNotificationReadDetail(prev, readDetail);
          itemsRef.current = next;
          return next;
        });
        router.push(href);
      }
    },
    [router, token],
  );

  const uiLoadState: LoadState = authLoading ? "auth-wait" : loadState;
  const showSkeleton = shouldShowLoadingSkeleton(uiLoadState, userItems.length);
  const showEmpty = !authLoading && authReady && shouldShowDataEmpty(uiLoadState, userItems.length);
  const showRetryNotice = uiLoadState === "rate-limited" && userItems.length === 0 && Boolean(retryNotice);

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-indigo-50/40 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-3xl px-4 py-8" data-testid="notifications-page">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <div className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm shadow-sm">
            <span className="mr-2">🔔</span>
            <span className="font-semibold tabular-nums">{unread}</span>
            <span className="text-slate-500"> unread</span>
          </div>
        </div>
        <p className="mt-2 text-sm text-slate-600">
          Booking approvals and requests open on the booking detail page; opening a notification marks matching rows
          read and refreshes the nav badge.
        </p>

        {authLoading ? <PageAuthLoading label="Loading your notifications…" /> : null}

        {showRetryNotice ? (
          <div
            className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            data-testid="sync-status-banner"
            role="status"
          >
            {retryNotice}
          </div>
        ) : null}

        {uiLoadState === "error" && userItems.length === 0 ? (
          <SyncStatusBanner
            state="error"
            rowCount={0}
            onRetry={() => void reloadNotifications("manual-retry")}
          />
        ) : null}

        {showSkeleton ? (
          <div className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
            <TableRowsSkeleton rows={6} data-testid="notifications-table-skeleton" />
          </div>
        ) : userItems.length > 0 ? (
          <ul
            className="mt-6 divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white shadow-sm"
            data-testid="notifications-feed"
          >
            {userItems.map((item) => {
              const href = notificationHrefForSurface(item, "user");
              const title = notificationTitleForSurface(item, "user");
              const unreadRow = !item.read_at;
              const inner = (
                <div
                  className={`flex flex-col gap-1 px-4 py-3 ${unreadRow ? "bg-amber-50/50" : ""}`}
                  data-testid={`notification-row-${item.id}`}
                >
                  <span className="text-sm font-medium text-slate-900">{title}</span>
                  <span className="text-xs text-slate-400">
                    {item.created_at ? new Date(item.created_at).toLocaleString() : ""}
                  </span>
                </div>
              );
              return (
                <li key={`${item.id}-${item.created_at}`}>
                  {href ? (
                    <Link
                      href={href}
                      className="block hover:bg-slate-50/80"
                      onClick={(event) => {
                        event.preventDefault();
                        void openNotification(item, href);
                      }}
                    >
                      {inner}
                    </Link>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        ) : showEmpty ? (
          <p
            className="mt-6 rounded-xl border border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-600 shadow-sm"
            data-testid="notifications-empty"
          >
            No notifications yet.
          </p>
        ) : null}

        <p className="mt-6 text-sm text-slate-600">
          <Link href="/dashboard/bookings" className="font-medium text-teal-700 hover:underline">
            My bookings
          </Link>
          {" · "}
          <Link href="/dashboard/landlord" className="font-medium text-teal-700 hover:underline">
            Landlord dashboard
          </Link>
        </p>
      </main>
    </div>
  );
}
