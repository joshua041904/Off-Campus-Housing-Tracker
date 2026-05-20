import { describe, expect, it } from "vitest";
import { extractNotificationEnvelopeMeta } from "../src/kafka-consumer.js";

describe("extractNotificationEnvelopeMeta", () => {
  it("BookingRequestV1 uses payload landlord_id as userId, not aggregate_id (booking id)", () => {
    const landlord_id = "55555555-5555-4555-8555-555555555555";
    const bookingAggregate = "22222222-2222-4222-8222-222222222222";
    const buf = Buffer.from(
      JSON.stringify({
        metadata: {
          event_id: "11111111-1111-4111-8111-111111111111",
          event_type: "BookingRequestV1",
          aggregate_id: bookingAggregate,
        },
        payload: {
          booking_id: bookingAggregate,
          landlord_id,
          listing_id: "33333333-3333-4333-8333-333333333333",
          renter_id: "44444444-4444-4444-8444-444444444444",
        },
      }),
      "utf8",
    );
    const meta = extractNotificationEnvelopeMeta(buf);
    expect(meta).not.toBeNull();
    expect(meta!.userId).toBe(landlord_id);
    expect(meta!.userId).not.toBe(bookingAggregate);
  });

  it("BookingRequestV1 prefers camelCase landlordId when snake_case absent", () => {
    const landlordId = "66666666-6666-4666-8666-666666666666";
    const buf = Buffer.from(
      JSON.stringify({
        metadata: {
          event_type: "BookingRequestV1",
          aggregate_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        },
        payload: { landlordId },
      }),
      "utf8",
    );
    const meta = extractNotificationEnvelopeMeta(buf);
    expect(meta!.userId).toBe(landlordId);
  });

  it("community.comment.notification targets recipient_id (post author)", () => {
    const recipient = "77777777-7777-4777-8777-777777777777";
    const buf = Buffer.from(
      JSON.stringify({
        metadata: {
          event_id: "88888888-8888-4888-8888-888888888888",
          event_type: "community.comment.notification",
          aggregate_id: "99999999-9999-4999-8999-999999999999",
        },
        payload: {
          version: "v1",
          recipient_id: recipient,
          post_id: "aaaaaaaa-bbbb-4ccc-8ddd-111111111111",
          comment_id: "aaaaaaaa-bbbb-4ccc-8ddd-222222222222",
          actor_id: "aaaaaaaa-bbbb-4ccc-8ddd-333333333333",
        },
      }),
      "utf8",
    );
    const meta = extractNotificationEnvelopeMeta(buf);
    expect(meta!.userId).toBe(recipient);
  });

  it("booking.status.updated PENDING targets landlord_id", () => {
    const landlord = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const buf = Buffer.from(
      JSON.stringify({
        metadata: {
          event_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          event_type: "booking.status.updated",
          aggregate_id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        },
        payload: {
          version: "v1",
          tenant_id: "aaaaaaaa-bbbb-4ccc-8ddd-111111111111",
          landlord_id: landlord,
          new_status: "PENDING",
          previous_status: null,
        },
      }),
      "utf8",
    );
    const meta = extractNotificationEnvelopeMeta(buf);
    expect(meta!.userId).toBe(landlord);
  });

  it("booking.thread.ensure has no notification recipient", () => {
    const buf = Buffer.from(
      JSON.stringify({
        metadata: {
          event_id: "10101010-1010-4101-8101-101010101010",
          event_type: "booking.thread.ensure",
          aggregate_id: "20202020-2020-4202-8202-202020202020",
        },
        payload: { booking_id: "20202020-2020-4202-8202-202020202020" },
      }),
      "utf8",
    );
    const meta = extractNotificationEnvelopeMeta(buf);
    expect(meta!.userId).toBeNull();
  });

  it("booking.status.updated ACCEPTED notifies tenant_id", () => {
    const tenant = "aaaaaaaa-bbbb-4ccc-8ddd-111111111111";
    const buf = Buffer.from(
      JSON.stringify({
        metadata: {
          event_id: "bbbbbbbb-bbbb-4bbb-8bbb-222222222222",
          event_type: "booking.status.updated",
          aggregate_id: "cccccccc-cccc-4ccc-8ccc-333333333333",
        },
        payload: {
          version: "v1",
          tenant_id: tenant,
          new_status: "ACCEPTED",
          previous_status: "PENDING",
        },
      }),
      "utf8",
    );
    const meta = extractNotificationEnvelopeMeta(buf);
    expect(meta!.userId).toBe(tenant);
  });
});
