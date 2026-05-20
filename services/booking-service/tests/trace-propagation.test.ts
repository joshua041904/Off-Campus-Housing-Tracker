import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { buildOutgoingHttpHeadersFromContextMock } = vi.hoisted(() => ({
  buildOutgoingHttpHeadersFromContextMock: vi.fn(() => ({
    traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
  })),
}));

vi.mock("@common/utils/otel", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@common/utils/otel")>();
  return {
    ...actual,
    buildOutgoingHttpHeadersFromContext: buildOutgoingHttpHeadersFromContextMock,
  };
});

import { notifyLandlordBookingRequestHttp } from "../src/notify-landlord-booking-request.js";
import { fetchListingMetaForBookingRequest } from "../src/listing-request-meta.js";

describe("booking-service downstream trace propagation", () => {
  beforeAll(() => {
    buildOutgoingHttpHeadersFromContextMock.mockClear();
  });

  beforeEach(() => {
    buildOutgoingHttpHeadersFromContextMock.mockClear();
    process.env.BOOKING_LISTINGS_INTERNAL_SECRET = "test-secret";
    process.env.LISTINGS_HTTP = "http://listings-service.off-campus-housing-tracker.svc.cluster.local:4012";
    process.env.NOTIFICATION_HTTP = "http://notification-service.off-campus-housing-tracker.svc.cluster.local:4015";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("injects trace headers when booking request fetches listing metadata", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          landlord_id: "6f95da1b-c61d-42cc-90fd-c41ba5c46d02",
          price_cents: 125000,
          title: "Trace listing",
          listing_on_hold: false,
          pricing_mode: "fixed",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const meta = await fetchListingMetaForBookingRequest("1c4ed06c-c77a-41bd-a98f-a6319858bc39", {} as never);
    expect(meta?.landlordId).toBe("6f95da1b-c61d-42cc-90fd-c41ba5c46d02");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(buildOutgoingHttpHeadersFromContextMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/internal/listings/1c4ed06c-c77a-41bd-a98f-a6319858bc39");
    const headers = new Headers(init.headers);
    expect(headers.get("x-booking-internal-secret")).toBe("test-secret");
    expect(headers.get("traceparent")).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[12]$/);
  });

  it("injects trace headers when booking-service posts landlord notifications", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await notifyLandlordBookingRequestHttp(
      {
        landlordId: "cd69fd5e-1d32-414e-82d0-cfb3fa50b883",
        bookingId: "7b7fb772-0c41-45d4-b65d-f1c6c1db27ef",
        listingId: "1c4ed06c-c77a-41bd-a98f-a6319858bc39",
        tenantId: "79389f58-f1d1-45ee-9606-146be58f2c8a",
        createdAt: "2026-05-14T13:00:00.000Z",
        listingTitle: "Trace listing",
        tenantUsername: "trace_tenant",
        tenantDisplayName: "Trace Tenant",
        tenantEmail: "trace@example.com",
        bookingStatus: "PENDING",
        startDate: "2026-05-20",
        endDate: "2026-05-21",
      },
      {} as never,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(buildOutgoingHttpHeadersFromContextMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://notification-service.off-campus-housing-tracker.svc.cluster.local:4015/internal/push-notification");
    const headers = new Headers(init.headers);
    expect(headers.get("x-booking-internal-secret")).toBe("test-secret");
    expect(headers.get("traceparent")).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[12]$/);
  });
});
