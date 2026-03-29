/**
 * When ANALYTICS_SYNC_MODE=1, synchronously POST to analytics so Playwright / E2E see daily_metrics
 * immediately. Uses the same event_id as Kafka so analytics.processed_events dedupes.
 */
const DEFAULT_ANALYTICS_HTTP =
  "http://analytics-service.off-campus-housing-tracker.svc.cluster.local:4017";

export async function syncListingCreatedToAnalytics(input: {
  eventId: string;
  listedAtDay: string;
}): Promise<void> {
  if (process.env.ANALYTICS_SYNC_MODE !== "1") return;

  const base = (
    process.env.ANALYTICS_HTTP_INGEST_URL ||
    process.env.ANALYTICS_HTTP_URL ||
    DEFAULT_ANALYTICS_HTTP
  ).replace(/\/$/, "");
  const url = `${base}/internal/ingest/listing-created`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Internal-Call": "listing-sync",
  };
  const tok = (process.env.ANALYTICS_INTERNAL_INGEST_TOKEN || process.env.LISTINGS_ANALYTICS_INGEST_TOKEN || "").trim();
  if (tok) headers["X-Internal-Ingest-Token"] = tok;

  const ms = Number(process.env.LISTINGS_ANALYTICS_SYNC_TIMEOUT_MS || "8000");
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), Math.max(1000, ms));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ event_id: input.eventId, listed_at_day: input.listedAtDay }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`analytics ingest ${res.status} ${txt}`);
    }
  } finally {
    clearTimeout(t);
  }
}
