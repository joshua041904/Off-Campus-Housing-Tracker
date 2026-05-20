/** Classify API failures without exposing raw endpoint labels in product UI. */

export type FetchFailureKind = "rate-limited" | "error";

export function is429Error(error: unknown): boolean {
  if (error instanceof Error) {
    const m = error.message.toLowerCase();
    return /\b429\b/.test(error.message) || m.includes("too many requests") || m.includes("rate limit");
  }
  if (typeof error === "object" && error != null && "status" in error) {
    return Number((error as { status: unknown }).status) === 429;
  }
  return false;
}

export function classifyFetchFailure(error: unknown): FetchFailureKind {
  return is429Error(error) ? "rate-limited" : "error";
}

/** User-safe copy — never includes API route names or HTTP status codes. */
export function userSafeLoadMessage(surface: string, kind: FetchFailureKind): string {
  if (kind === "rate-limited") return "Still syncing. Retrying…";
  return `Could not load ${surface}. Retry`;
}

export function userSafeSearchMessage(kind: FetchFailureKind): string {
  if (kind === "rate-limited") {
    return "Listings are still syncing. We will retry automatically.";
  }
  return "Could not load listings right now. Try again in a moment.";
}

/** Dev-only: log raw API errors when NEXT_PUBLIC_PERF_DEBUG=1. */
export function logFetchFailureDebug(label: string, error: unknown): void {
  if (process.env.NEXT_PUBLIC_PERF_DEBUG !== "1") return;
  const detail = error instanceof Error ? error.message : String(error);
  console.debug(`[och-fetch] ${label}:`, detail);
}
