import { describe, expect, it } from "vitest";
import type { NotificationItem } from "./api";
import { bookingNotificationsToThreadSummaries } from "./booking-notifications-to-messaging";

describe("bookingNotificationsToThreadSummaries", () => {
  it("maps tenant booking.accepted to a row with bookingHref nid and from=tenant", () => {
    const nid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const bookingId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const n: NotificationItem = {
      id: nid,
      event_type: "booking.accepted",
      channel: "push",
      status: "pending",
      payload: {
        notification_category: "booking_renter",
        booking_id: bookingId,
        listing_title: "Oak Lane 2BR",
        landlord_username: "host_jo",
      },
      created_at: "2026-05-01T10:00:00.000Z",
      dedupe_key: "tenant-uuid:booking.accepted:booking:booking-uuid-1:APPROVAL",
    };
    const rows = bookingNotificationsToThreadSummaries([n]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(`notif:${nid}`);
    expect(rows[0].bookingHref).toContain(`/dashboard/bookings/${bookingId}`);
    expect(rows[0].bookingHref).toContain(`nid=${nid}`);
    expect(rows[0].bookingHref).toContain("from=tenant");
  });

  it("maps landlord booking.created with from=landlord", () => {
    const nid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const bookingId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const n: NotificationItem = {
      id: nid,
      event_type: "booking.created",
      channel: "push",
      status: "pending",
      payload: {
        notification_category: "booking_landlord",
        booking_id: bookingId,
        listing_title: "Maple Hall",
        tenant_username: "renter_sam",
      },
      created_at: "2026-05-02T11:00:00.000Z",
      dedupe_key: `landlord-uuid:booking.created:booking:${bookingId}:PENDING`,
    };
    const rows = bookingNotificationsToThreadSummaries([n]);
    expect(rows).toHaveLength(1);
    expect(rows[0].bookingHref).toContain("from=landlord");
    expect(rows[0].bookingHref).toContain(`nid=${nid}`);
  });

  it("dedupes duplicate dedupe_key before mapping", () => {
    const bookingId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const dup: NotificationItem = {
      id: "11111111-1111-4111-8111-111111111111",
      event_type: "booking.accepted",
      channel: "push",
      status: "pending",
      payload: {
        notification_category: "booking_renter",
        booking_id: bookingId,
      },
      created_at: "2026-01-01T00:00:00.000Z",
      dedupe_key: `u:booking.accepted:booking:${bookingId}:APPROVAL`,
    };
    const newer: NotificationItem = {
      ...dup,
      id: "22222222-2222-4222-8222-222222222222",
      created_at: "2026-01-02T00:00:00.000Z",
    };
    const rows = bookingNotificationsToThreadSummaries([newer, dup]);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe("notif:22222222-2222-4222-8222-222222222222");
  });
});
