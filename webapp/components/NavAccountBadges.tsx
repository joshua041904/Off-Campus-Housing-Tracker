"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { getMessagingUnreadTotal, getNotificationUnreadCount } from "@/lib/api";
import { getStoredToken } from "@/lib/auth-storage";

/**
 * In-nav counts backed by the same APIs as dashboard / inbox (not a separate fake counter).
 */
export function NavAccountBadges() {
  const [notif, setNotif] = useState(0);
  const [msg, setMsg] = useState(0);

  const refresh = useCallback(async () => {
    const t = getStoredToken();
    if (!t) {
      setNotif(0);
      setMsg(0);
      return;
    }
    try {
      const [nextNotif, m] = await Promise.all([
        getNotificationUnreadCount(t, { scope: "user" }).catch(() => 0),
        getMessagingUnreadTotal(t).catch(() => 0),
      ]);
      setNotif(Number(nextNotif) || 0);
      setMsg(Number(m) || 0);
    } catch {
      setNotif(0);
      setMsg(0);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 45_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onOch = () => void refresh();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("och:badges-refresh", onOch as EventListener);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("och:badges-refresh", onOch as EventListener);
    };
  }, [refresh]);

  if (notif === 0 && msg === 0) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-slate-500">
        <Link href="/dashboard/notifications" className="hover:text-teal-700" title="Notifications">
          🔔
        </Link>
        <span className="text-slate-300">|</span>
        <span title="Unread messages">💬 0</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
      <Link
        href="/dashboard/notifications"
        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-amber-900 ring-1 ring-amber-200 hover:bg-amber-100"
        title="Notifications"
      >
        🔔{notif > 0 ? <span className="tabular-nums">{notif > 99 ? "99+" : notif}</span> : null}
      </Link>
      <Link
        href="/dashboard/messages"
        className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-sky-900 ring-1 ring-sky-200 hover:bg-sky-100"
        title="Unread messages"
      >
        💬{msg > 0 ? <span className="tabular-nums">{msg > 99 ? "99+" : msg}</span> : null}
      </Link>
    </span>
  );
}
