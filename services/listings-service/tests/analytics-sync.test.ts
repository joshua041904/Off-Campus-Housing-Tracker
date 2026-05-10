/**
 * Coverage for `syncListingCreatedToAnalytics` (fetch + env branches).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("syncListingCreatedToAnalytics", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.ANALYTICS_SYNC_MODE;
    delete process.env.ANALYTICS_HTTP_INGEST_URL;
    delete process.env.ANALYTICS_HTTP_URL;
    delete process.env.ANALYTICS_INTERNAL_INGEST_TOKEN;
    delete process.env.LISTINGS_ANALYTICS_INGEST_TOKEN;
    delete process.env.LISTINGS_ANALYTICS_SYNC_TIMEOUT_MS;
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("no-ops when ANALYTICS_SYNC_MODE is not 1", async () => {
    const { syncListingCreatedToAnalytics } = await import(
      "../src/analytics-sync.js"
    );
    await syncListingCreatedToAnalytics({
      eventId: "00000000-0000-4000-8000-000000000001",
      listedAtDay: "2026-01-01",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs ingest URL when MODE=1 and response ok", async () => {
    process.env.ANALYTICS_SYNC_MODE = "1";
    process.env.ANALYTICS_HTTP_INGEST_URL = "http://127.0.0.1:9/";
    process.env.LISTINGS_ANALYTICS_SYNC_TIMEOUT_MS = "1000";
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => "",
    });
    const { syncListingCreatedToAnalytics } = await import(
      "../src/analytics-sync.js"
    );
    await syncListingCreatedToAnalytics({
      eventId: "00000000-0000-4000-8000-000000000002",
      listedAtDay: "2026-02-02",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/internal/ingest/listing-created");
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain("event_id");
  });

  it("throws when response not ok", async () => {
    process.env.ANALYTICS_SYNC_MODE = "1";
    process.env.ANALYTICS_HTTP_INGEST_URL = "http://127.0.0.1:9/";
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "bad",
    });
    const { syncListingCreatedToAnalytics } = await import(
      "../src/analytics-sync.js"
    );
    await expect(
      syncListingCreatedToAnalytics({
        eventId: "00000000-0000-4000-8000-000000000003",
        listedAtDay: "2026-03-03",
      }),
    ).rejects.toThrow(/analytics ingest 502/);
  });
});
