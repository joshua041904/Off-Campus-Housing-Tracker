"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getStoredToken } from "@/lib/auth-storage";
import {
  classifyNotification,
  extractBookingNotificationShape,
  notificationHrefForSurface,
  notificationTitleForSurface,
  parseNotificationPayloadDeep,
} from "@/lib/notification-booking";
import type { NotificationItem } from "@/lib/api";

type Toast = { id: string; title: string; body: string; href: string };

function toastFromPayload(payload: Record<string, unknown>): Toast | null {
  const et = String(payload.event_type ?? payload.event ?? "").trim();
  const fakeItem: NotificationItem = {
    id: "live",
    event_type: et,
    channel: "push",
    status: "pending",
    payload: payload as NotificationItem["payload"],
    created_at: new Date().toISOString(),
  };
  const deep = String(payload.deep_link ?? "").trim();
  const bid = String(payload.booking_id ?? payload.bookingId ?? "").trim();
  const classification = classifyNotification(fakeItem);
  const surface = classification.audience === "landlord" ? "landlord" : "user";
  const bookingPath =
    deep && deep.includes("/dashboard/bookings/")
      ? deep.startsWith("/")
        ? deep
        : `/${deep}`
      : bid
        ? `/dashboard/bookings/${encodeURIComponent(bid)}`
        : "";
  if (classification.category === "booking_landlord" || classification.category === "booking_renter") {
    return {
      id: `t-${Date.now()}`,
      title: notificationTitleForSurface(fakeItem, surface),
      body:
        classification.category === "booking_landlord"
          ? "There is an update on one of your landlord bookings."
          : "There is an update on one of your bookings.",
      href: notificationHrefForSurface(fakeItem, surface) || bookingPath || "/dashboard/notifications",
    };
  }
  if (et === "community.comment.notification") {
    return {
      id: `t-${Date.now()}`,
      title: "New comment",
      body: String(payload.post_title ?? "Your community post").slice(0, 80),
      href: String(payload.deep_link ?? "/community").startsWith("/")
        ? String(payload.deep_link)
        : `/${String(payload.deep_link ?? "community")}`,
    };
  }
  if (et === "community.reply.notification") {
    return {
      id: `t-${Date.now()}`,
      title: "New reply",
      body: String(payload.snippet ?? "Someone replied to your comment").slice(0, 80),
      href: String(payload.deep_link ?? "/community").startsWith("/")
        ? String(payload.deep_link)
        : `/${String(payload.deep_link ?? "community")}`,
    };
  }
  const parsed = parseNotificationPayloadDeep(fakeItem);
  const shape = extractBookingNotificationShape(fakeItem, parsed);
  if (shape.bookingId && (et.includes("booking") || shape.deepLink)) {
    return {
      id: `t-${Date.now()}`,
      title: "Booking update",
      body: "There is an update on one of your bookings.",
      href: shape.deepLink.startsWith("/") ? shape.deepLink : `/${shape.deepLink}`,
    };
  }
  return {
    id: `t-${Date.now()}`,
    title: "Notification",
    body: et || "New activity on your account.",
    href: "/dashboard/notifications",
  };
}

export function GlobalNotificationToasts() {
  const [queue, setQueue] = useState<Toast[]>([]);

  const pushToast = useCallback((t: Toast) => {
    setQueue((q) => [...q.slice(-2), t]);
    window.setTimeout(() => {
      setQueue((q) => q.filter((x) => x.id !== t.id));
    }, 8000);
  }, []);

  useEffect(() => {
    const onLive = (ev: Event) => {
      const ce = ev as CustomEvent<{ payload?: Record<string, unknown> }>;
      const payload = ce.detail?.payload;
      if (!payload || typeof payload !== "object") return;
      const t = toastFromPayload(payload);
      if (t) pushToast(t);
    };
    window.addEventListener("och:live-notification", onLive as EventListener);
    return () => window.removeEventListener("och:live-notification", onLive as EventListener);
  }, [pushToast]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = getStoredToken();
    if (!token) return;
    const authToken = token;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function clearReconnect() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function scheduleReconnect() {
      if (cancelled) return;
      clearReconnect();
      attempt += 1;
      const delayMs = Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
      reconnectTimer = setTimeout(connect, delayMs);
    }

    function connect() {
      if (cancelled) return;
      clearReconnect();
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${protocol}://${window.location.host}/ws?token=${encodeURIComponent(authToken)}`;
      try {
        socket = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      socket.onopen = () => {
        attempt = 0;
      };
      socket.onmessage = (event) => {
        try {
          const parsed = JSON.parse(String(event.data || "{}")) as {
            type?: string;
            payload?: Record<string, unknown>;
          };
          if (parsed.type === "notification" && parsed.payload) {
            window.dispatchEvent(
              new CustomEvent("och:live-notification", { detail: { payload: parsed.payload } }),
            );
            window.dispatchEvent(new Event("och:badges-refresh"));
          }
        } catch {
          /* ignore */
        }
      };
      socket.onclose = () => {
        socket = null;
        if (!cancelled) scheduleReconnect();
      };
    }

    connect();
    return () => {
      cancelled = true;
      clearReconnect();
      socket?.close();
      socket = null;
    };
  }, []);

  if (!queue.length) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0">
      {queue.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto rounded-lg border border-teal-200 bg-white/95 p-3 shadow-lg ring-1 ring-teal-100"
        >
          <p className="text-sm font-semibold text-slate-900">{t.title}</p>
          <p className="mt-1 line-clamp-2 text-xs text-slate-600">{t.body}</p>
          <Link href={t.href} className="mt-2 inline-block text-xs font-medium text-teal-800 hover:underline">
            Open
          </Link>
        </div>
      ))}
    </div>
  );
}
