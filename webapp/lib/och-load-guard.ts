"use client";

import { useCallback, useEffect, useRef } from "react";

/** Monotonic request sequence — ignore stale responses after user switch or newer load. */
export function useLoadSequenceGuard() {
  const loadSeq = useRef(0);
  const lastUserId = useRef<string | null>(null);

  const beginLoad = useCallback(() => {
    const seq = ++loadSeq.current;
    return seq;
  }, []);

  const isStale = useCallback((seq: number) => seq !== loadSeq.current, []);

  const onUserChange = useCallback((nextUserId: string | null) => {
    const prev = lastUserId.current;
    if (prev && nextUserId && prev !== nextUserId) {
      loadSeq.current += 1;
    }
    if (!nextUserId) {
      loadSeq.current += 1;
    }
    lastUserId.current = nextUserId;
  }, []);

  const invalidate = useCallback(() => {
    loadSeq.current += 1;
  }, []);

  return { beginLoad, isStale, onUserChange, invalidate };
}

export function createDebouncedCallback(fn: () => void, delayMs = 300): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delayMs);
  };
}

/** Register standard dashboard reload listeners (debounced). */
export function useDashboardReloadEvents(
  enabled: boolean,
  reload: (reason: string) => void,
  delayMs = 300,
): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const debouncedRef = useRef<(() => void) | null>(null);
  if (!debouncedRef.current) {
    debouncedRef.current = createDebouncedCallback(() => reloadRef.current("event-refresh"), delayMs);
  }

  const schedule = debouncedRef.current!;

  useEffect(() => {
    if (!enabled) return;
    const onVisibility = () => {
      if (document.visibilityState === "visible") schedule();
    };
    window.addEventListener("och:badges-refresh", schedule);
    window.addEventListener("och:live-notification", schedule);
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("och:badges-refresh", schedule);
      window.removeEventListener("och:live-notification", schedule);
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, schedule]);
}
