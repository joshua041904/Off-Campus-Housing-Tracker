"use client";

import { useEffect } from "react";

type NotificationMessage = {
  type?: string;
  payload?: Record<string, unknown>;
};

export function useNotificationsRealtime(token: string | null, onNotification: (payload: Record<string, unknown>) => void): void {
  useEffect(() => {
    if (!token || typeof window === "undefined") return;
    const authToken = token;
    let cancelled = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

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
          const parsed = JSON.parse(String(event.data || "{}")) as NotificationMessage;
          if (parsed.type === "notification" && parsed.payload) onNotification(parsed.payload);
        } catch {
          // ignore invalid frames
        }
      };
      socket.onerror = () => {
        // Browser also fires onclose; reconnect there to avoid double timers.
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
  }, [token, onNotification]);
}
