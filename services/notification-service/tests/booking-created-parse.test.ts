import { describe, expect, it } from "vitest";
import {
  normalizeLandlordBookingNotificationPayload,
  parseBookingCreated,
} from "../src/consumers/booking-created.js";

describe("parseBookingCreated", () => {
  it("parses booking-service envelope for BookingRequestV1", () => {
    const buf = Buffer.from(
      JSON.stringify({
        metadata: {
          event_id: "11111111-1111-4111-8111-111111111111",
          event_type: "BookingRequestV1",
          aggregate_id: "22222222-2222-4222-8222-222222222222",
          aggregate_type: "booking",
          occurred_at: new Date().toISOString(),
          producer: "booking-service",
          version: "1",
        },
        payload: {
          booking_id: "22222222-2222-4222-8222-222222222222",
          listing_id: "33333333-3333-4333-8333-333333333333",
          tenant_id: "44444444-4444-4444-8444-444444444444",
          renter_id: "44444444-4444-4444-8444-444444444444",
          landlord_id: "55555555-5555-4555-8555-555555555555",
        },
      }),
      "utf8",
    );
    const out = parseBookingCreated(buf);
    expect(out).not.toBeNull();
    expect(out!.listingId).toBe("33333333-3333-4333-8333-333333333333");
    expect(out!.renterId).toBe("44444444-4444-4444-8444-444444444444");
    expect(out!.landlordId).toBe("55555555-5555-4555-8555-555555555555");
    expect(out!.bookingId).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("maps camelCase landlordId from payload", () => {
    const landlordId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const buf = Buffer.from(
      JSON.stringify({
        metadata: { event_type: "BookingRequestV1", aggregate_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
        payload: {
          bookingId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          listingId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          renterId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          landlordId,
        },
      }),
      "utf8",
    );
    const parsed = parseBookingCreated(buf);
    expect(parsed).not.toBeNull();
    expect(parsed!.landlordId).toBe(landlordId);
  });

  it("parses when payload is a JSON string", () => {
    const inner = {
      booking_id: "22222222-2222-4222-8222-222222222222",
      listing_id: "33333333-3333-4333-8333-333333333333",
      tenant_id: "44444444-4444-4444-8444-444444444444",
      renter_id: "44444444-4444-4444-8444-444444444444",
      landlord_id: "55555555-5555-4555-8555-555555555555",
    };
    const buf = Buffer.from(
      JSON.stringify({
        metadata: {
          event_id: "11111111-1111-4111-8111-111111111111",
          event_type: "BookingRequestV1",
          aggregate_id: "22222222-2222-4222-8222-222222222222",
        },
        payload: JSON.stringify(inner),
      }),
      "utf8",
    );
    const out = parseBookingCreated(buf);
    expect(out).not.toBeNull();
    expect(out!.bookingId).toBe("22222222-2222-4222-8222-222222222222");
    expect(out!.landlordId).toBe("55555555-5555-4555-8555-555555555555");
  });

  it("preserves frontend-ready booking.created identity and date fields", () => {
    const bookingId = "22222222-2222-4222-8222-222222222222";
    const listingId = "33333333-3333-4333-8333-333333333333";
    const tenantId = "44444444-4444-4444-8444-444444444444";
    const landlordId = "55555555-5555-4555-8555-555555555555";
    const buf = Buffer.from(
      JSON.stringify({
        metadata: {
          event_type: "BookingCreatedV1",
          aggregate_id: bookingId,
        },
        payload: {
          booking_id: bookingId,
          listing_id: listingId,
          tenant_id: tenantId,
          renter_id: tenantId,
          landlord_id: landlordId,
          listing_title: "2 room apt",
          tenant_username: "booker123",
          tenant_username_snapshot: "booker123_507ab69b2d",
          tenant_display_name: "Booker 123",
          tenant_email: "booker@example.com",
          booking_status: "PENDING",
          start_date: "2026-08-15",
          end_date: "2026-12-20",
          deep_link: `/dashboard/bookings/${bookingId}`,
        },
      }),
      "utf8",
    );
    const parsed = parseBookingCreated(buf);
    expect(parsed).not.toBeNull();

    const normalized = normalizeLandlordBookingNotificationPayload({
      ...parsed!,
      notificationSource: "kafka.booking.created",
    });
    expect(normalized).toMatchObject({
      booking_id: bookingId,
      listing_id: listingId,
      listing_title: "2 room apt",
      tenant_id: tenantId,
      tenant_username: "booker123",
      tenant_username_snapshot: "booker123_507ab69b2d",
      tenant_display_name: "Booker 123",
      tenant_email: "booker@example.com",
      booking_status: "PENDING",
      start_date: "2026-08-15",
      end_date: "2026-12-20",
      deep_link: `/dashboard/bookings/${bookingId}`,
      source: "kafka.booking.created",
    });
  });

  it("returns null when envelope event_type is unknown", () => {
    const buf = Buffer.from(
      JSON.stringify({
        metadata: { event_type: "SomethingElseV1" },
        payload: { landlord_id: "55555555-5555-4555-8555-555555555555" },
      }),
      "utf8",
    );
    expect(parseBookingCreated(buf)).toBeNull();
  });
});
