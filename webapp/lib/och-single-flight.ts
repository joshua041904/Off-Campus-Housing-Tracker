/** Debounced single-flight loader with exponential backoff on 429. */

import { classifyFetchFailure, is429Error } from "./och-fetch-errors";

export type SingleFlightLoader<T> = {
  run: (reason: string) => Promise<T | null>;
  schedule: (reason: string) => void;
  cancelRetry: () => void;
  isInFlight: () => boolean;
};

export function createSingleFlightLoader<T>(
  fn: (reason: string) => Promise<T>,
  options?: { debounceMs?: number; maxRetryMs?: number; onRateLimited?: () => void },
): SingleFlightLoader<T> {
  const debounceMs = options?.debounceMs ?? 300;
  const maxRetryMs = options?.maxRetryMs ?? 30_000;
  let inFlight: Promise<T> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryCount = 0;
  let pendingReason: string | null = null;

  const cancelRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const scheduleRetry = (reason: string) => {
    cancelRetry();
    const base = Math.min(maxRetryMs, 1000 * 2 ** retryCount);
    const jitter = Math.floor(Math.random() * 500);
    retryCount += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void runInternal(reason);
    }, base + jitter);
  };

  async function runInternal(reason: string): Promise<T | null> {
    if (inFlight) return inFlight;
    pendingReason = null;
    inFlight = (async () => {
      try {
        const result = await fn(reason);
        retryCount = 0;
        return result;
      } catch (error) {
        if (is429Error(error)) {
          options?.onRateLimited?.();
          scheduleRetry(reason);
        }
        throw error;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  const run = async (reason: string): Promise<T | null> => {
    try {
      return await runInternal(reason);
    } catch {
      return null;
    }
  };

  const schedule = (reason: string) => {
    pendingReason = reason;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      const r = pendingReason ?? reason;
      pendingReason = null;
      if (inFlight) return;
      void runInternal(r);
    }, debounceMs);
  };

  return {
    run,
    schedule,
    cancelRetry,
    isInFlight: () => inFlight != null,
  };
}

export function surfaceStateFromSettled(
  status: "fulfilled" | "rejected",
  reason?: unknown,
): "loaded" | "error" | "rate-limited" {
  if (status === "fulfilled") return "loaded";
  return classifyFetchFailure(reason) === "rate-limited" ? "rate-limited" : "error";
}
