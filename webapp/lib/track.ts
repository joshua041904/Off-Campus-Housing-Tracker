/**
 * Lightweight client-side event tracking for trust/moderation actions.
 * Fire-and-forget — never blocks UX or throws to the caller.
 */

export type TrustEvent =
  | { type: "reputation_lookup"; userId: string }
  | { type: "report_submitted"; targetType: "listing" | "user"; category: string }
  | { type: "peer_review_submitted"; side: string; rating: number };

export function trackTrustEvent(event: TrustEvent): void {
  try {
    // Log to console in development
    if (process.env.NODE_ENV === "development") {
      console.info("[trust:track]", event);
    }
    // Fire-and-forget to analytics endpoint
    const body = JSON.stringify({
      event_type: event.type,
      occurred_at: new Date().toISOString(),
      payload: event,
    });
    void fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {
      // Silently ignore — tracking must never impact UX
    });
  } catch {
    // Silently ignore
  }
}
