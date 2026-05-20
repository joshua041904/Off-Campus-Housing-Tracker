/** Shared dashboard reload state machine: single-flight, latest-wins, backoff on 429. */

import { useCallback, useEffect, useRef, useState } from "react";
import { is429Error } from "./och-fetch-errors";
import { logPerfDebug } from "./och-perf";
import type { LoadState } from "./och-page-load";

export function resolveReloadFailureState(input: {
  isRateLimited: boolean;
  rowCount: number;
  hadPriorSuccess: boolean;
}): { loadState: LoadState; retryNotice: string | null } {
  const { isRateLimited, rowCount, hadPriorSuccess } = input;
  if (rowCount > 0 || hadPriorSuccess) {
    return { loadState: "loaded", retryNotice: null };
  }
  if (isRateLimited) {
    return { loadState: "rate-limited", retryNotice: "Still syncing. Retrying…" };
  }
  return { loadState: "error", retryNotice: null };
}

export function pickReloadStartState(input: {
  background: boolean;
  rowCount: number;
  current: LoadState;
}): LoadState {
  const { background, rowCount, current } = input;
  if (!background && rowCount === 0) {
    return current === "auth-wait" ? "auth-wait" : "initial-loading";
  }
  if (background && current === "loaded") return "refreshing";
  return current;
}

export function shouldShowSyncRetryBanner(loadState: LoadState, rowCount: number): boolean {
  return loadState === "rate-limited" && rowCount === 0;
}

export function shouldShowSyncErrorBanner(loadState: LoadState, rowCount: number): boolean {
  return loadState === "error" && rowCount === 0;
}

export function notificationReloadBackoffMs(retryCount: number, maxMs = 30_000): number {
  return Math.min(maxMs, 1000 * 2 ** retryCount) + Math.floor(Math.random() * 500);
}

export type UseOchSurfaceReloadOptions<T> = {
  enabled: boolean;
  logLabel?: string;
  fetch: (reason: string) => Promise<T>;
  onSuccess: (data: T, meta: { reason: string; background: boolean }) => void;
  getRowCount: () => number;
};

export function useOchSurfaceReload<T>({
  enabled,
  logLabel = "surface",
  fetch,
  onSuccess,
  getRowCount,
}: UseOchSurfaceReloadOptions<T>) {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [retryNotice, setRetryNotice] = useState<string | null>(null);

  const fetchRef = useRef(fetch);
  const onSuccessRef = useRef(onSuccess);
  const getRowCountRef = useRef(getRowCount);
  fetchRef.current = fetch;
  onSuccessRef.current = onSuccess;
  getRowCountRef.current = getRowCount;

  const requestSeqRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef(0);
  const lastSuccessAtRef = useRef<number | null>(null);
  const reloadDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const reloadRef = useRef<
    (reason: string, opts?: { background?: boolean }) => Promise<void | undefined>
  >(() => Promise.resolve());

  const scheduleRateLimitRetry = useCallback(() => {
    clearRetryTimer();
    const retryCount = retryCountRef.current++;
    const delayMs = notificationReloadBackoffMs(retryCount);
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      void reloadRef.current("retry-after-429", { background: true });
    }, delayMs);
  }, [clearRetryTimer]);

  const reload = useCallback(
    async (reason: string, opts?: { background?: boolean }) => {
      if (!enabled) return;
      if (inFlightRef.current) return inFlightRef.current;

      const seq = ++requestSeqRef.current;
      const background = Boolean(opts?.background);

      setLoadState((current) =>
        pickReloadStartState({ background, rowCount: getRowCountRef.current(), current }),
      );

      const task = (async () => {
        logPerfDebug(`${logLabel}:reload`, {
          reason,
          background,
          seq,
          inFlight: Boolean(inFlightRef.current),
          rowCount: getRowCountRef.current(),
        });

        try {
          const data = await fetchRef.current(reason);
          if (seq !== requestSeqRef.current) return;

          clearRetryTimer();
          retryCountRef.current = 0;
          lastSuccessAtRef.current = Date.now();
          onSuccessRef.current(data, { reason, background });
          setLoadState("loaded");
          setRetryNotice(null);
        } catch (error) {
          if (seq !== requestSeqRef.current) return;

          const isRateLimited = is429Error(error);
          const rowCount = getRowCountRef.current();
          const hadPriorSuccess = Boolean(lastSuccessAtRef.current);

          if (isRateLimited) {
            scheduleRateLimitRetry();
          }

          const next = resolveReloadFailureState({
            isRateLimited,
            rowCount,
            hadPriorSuccess,
          });
          setLoadState(next.loadState);
          setRetryNotice(next.retryNotice);
        } finally {
          if (seq === requestSeqRef.current) {
            inFlightRef.current = null;
          }
        }
      })();

      inFlightRef.current = task;
      return task;
    },
    [enabled, clearRetryTimer, logLabel, scheduleRateLimitRetry],
  );

  reloadRef.current = reload;

  const scheduleReload = useCallback(
    (reason: string, delayMs = 250) => {
      if (reloadDebounceRef.current) clearTimeout(reloadDebounceRef.current);
      reloadDebounceRef.current = setTimeout(() => {
        reloadDebounceRef.current = null;
        void reload(reason, { background: true });
      }, delayMs);
    },
    [reload],
  );

  useEffect(
    () => () => {
      clearRetryTimer();
      if (reloadDebounceRef.current) clearTimeout(reloadDebounceRef.current);
    },
    [clearRetryTimer],
  );

  return {
    loadState,
    setLoadState,
    retryNotice,
    reload,
    scheduleReload,
    requestSeqRef,
    lastSuccessAtRef,
    clearRetryTimer,
  };
}
