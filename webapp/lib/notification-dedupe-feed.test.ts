import { describe, expect, it } from "vitest";
import type { NotificationItem } from "./api";
import { parseNotificationPayloadDeep } from "./notification-booking";
import { renterLabelFromBookingPayload } from "./notification-booking-identity";
import {
  collapseLandlordBookingNotificationsByBookingId,
  dedupeNotificationFeed,
  mergeBookingContextDisplayNotification,
  notificationIdentityQualityFromPayload,
} from "./notification-dedupe-feed";

describe("dedupeNotificationFeed", () => {
  it("keeps one row per dedupe_key; same quality prefers newer created_at", () => {
    const older: NotificationItem = {
      id: "1",
      event_type: "booking.accepted",
      channel: "push",
      status: "pending",
      payload: { booking_id: "b" },
      created_at: "2026-01-01T00:00:00.000Z",
      dedupe_key: "u:booking.accepted:booking:b:APPROVAL",
    };
    const newer: NotificationItem = {
      id: "2",
      event_type: "booking.accepted",
      channel: "push",
      status: "pending",
      payload: { booking_id: "b" },
      created_at: "2026-01-02T00:00:00.000Z",
      dedupe_key: "u:booking.accepted:booking:b:APPROVAL",
    };
    const out = dedupeNotificationFeed([older, newer]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("2");
  });

  it("prefers handle-enriched row over newer UUID-only duplicate (same dedupe_key)", () => {
    const sparseNew: NotificationItem = {
      id: "sparse",
      event_type: "booking.accepted",
      channel: "push",
      status: "pending",
      payload: {
        notification_category: "booking_renter",
        booking_id: "booking-x",
        tenant_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      },
      created_at: "2026-05-10T12:00:00.000Z",
      dedupe_key: "u:booking.accepted:booking:booking-x:APPROVAL",
    };
    const richOld: NotificationItem = {
      id: "rich",
      event_type: "booking.accepted",
      channel: "push",
      status: "pending",
      payload: {
        notification_category: "booking_renter",
        booking_id: "booking-x",
        tenant_username_snapshot: "tomwang04312",
      },
      created_at: "2026-05-09T10:00:00.000Z",
      dedupe_key: "u:booking.accepted:booking:booking-x:APPROVAL",
    };
    const out = dedupeNotificationFeed([sparseNew, richOld]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("rich");
    expect(String(parseNotificationPayloadDeep(out[0]).tenant_username_snapshot)).toContain("tomwang");
  });

  it("stays unread until every duplicate in the group is read", () => {
    const unread: NotificationItem = {
      id: "a",
      event_type: "booking.created",
      channel: "push",
      status: "pending",
      payload: { notification_category: "booking_landlord", booking_id: "b1", tenant_username_snapshot: "u1" },
      created_at: "2026-01-02T00:00:00.000Z",
      dedupe_key: "k1",
    };
    const read: NotificationItem = {
      id: "b",
      event_type: "booking.created",
      channel: "push",
      status: "pending",
      payload: { notification_category: "booking_landlord", booking_id: "b1" },
      created_at: "2026-01-01T00:00:00.000Z",
      read_at: "2026-01-01T15:00:00.000Z",
      dedupe_key: "k1",
    };
    const out = dedupeNotificationFeed([unread, read]);
    expect(out[0].read_at).toBeTruthy();
    const allRead = dedupeNotificationFeed([
      { ...unread, read_at: "2026-01-02T16:00:00.000Z" },
      read,
    ]);
    expect(allRead[0].read_at).toBeTruthy();
  });
});

describe("notificationIdentityQualityFromPayload", () => {
  it("scores real handle above uuid tenant_id", () => {
    const qHandle = notificationIdentityQualityFromPayload({ tenant_username_snapshot: "tomwang04312" });
    const qUuid = notificationIdentityQualityFromPayload({
      tenant_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    });
    expect(qHandle).toBeGreaterThan(qUuid);
  });
});

describe("mergeBookingContextDisplayNotification", () => {
  it("uses confirmed lifecycle but merges username from enriched created row", () => {
    const created: NotificationItem = {
      id: "created",
      event_type: "booking.created",
      channel: "push",
      status: "pending",
      payload: {
        notification_category: "booking_landlord",
        booking_id: "bid-1",
        booking_status: "PENDING",
        tenant_username_snapshot: "tomwang04312",
        tenant_email: "tom@gmail.com",
      },
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const confirmed: NotificationItem = {
      id: "confirmed",
      event_type: "booking.confirmed",
      channel: "push",
      status: "pending",
      payload: {
        notification_category: "booking_landlord",
        booking_id: "bid-1",
        booking_status: "CONFIRMED",
        tenant_id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      },
      read_at: "2026-01-02T12:00:00.000Z",
      created_at: "2026-01-02T00:00:00.000Z",
    };
    const merged = collapseLandlordBookingNotificationsByBookingId([created, confirmed]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("confirmed");
    expect(merged[0].event_type).toBe("booking.confirmed");
    const p = parseNotificationPayloadDeep(merged[0]);
    expect(String(p.tenant_username_snapshot)).toContain("tomwang");
    expect(renterLabelFromBookingPayload(p)).toBe("@tomwang04312");
    expect(merged[0].read_at).toBeTruthy();
    const allRead = collapseLandlordBookingNotificationsByBookingId([
      { ...created, read_at: "2026-01-01T12:00:00.000Z" },
      confirmed,
    ]);
    expect(allRead[0].read_at).toBeTruthy();
  });
});

describe("mergeNotificationReadStateAcrossGroup", () => {
  it("marks collapsed row read when any duplicate in the booking context was read", () => {
    const booking = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const read: NotificationItem = {
      id: "read-row",
      event_type: "booking.confirmed",
      channel: "push",
      status: "pending",
      read_at: "2026-05-01T00:00:00.000Z",
      created_at: "2026-05-02T00:00:00.000Z",
      payload: { booking_id: booking, category: "booking" },
    };
    const unread: NotificationItem = {
      id: "unread-row",
      event_type: "booking.confirmed",
      channel: "push",
      status: "pending",
      created_at: "2026-05-01T00:00:00.000Z",
      payload: { booking_id: booking, category: "booking" },
    };
    const merged = mergeBookingContextDisplayNotification([read, unread]);
    expect(merged.read_at).toBeTruthy();
  });
});

describe("collapseLandlordBookingNotificationsByBookingId", () => {
  it("prefers confirmed over pending created for same booking", () => {
    const pending: NotificationItem = {
      id: "p",
      event_type: "booking.created",
      channel: "push",
      status: "pending",
      payload: {
        notification_category: "booking_landlord",
        notification_audience: "landlord",
        booking_id: "bid-1",
        booking_status: "PENDING",
        tenant_username_snapshot: "renter",
      },
      created_at: "2026-01-01T00:00:00.000Z",
    };
    const confirmed: NotificationItem = {
      id: "c",
      event_type: "booking.confirmed",
      channel: "push",
      status: "pending",
      payload: {
        notification_category: "booking_landlord",
        notification_audience: "landlord",
        booking_id: "bid-1",
        booking_status: "CONFIRMED",
        tenant_username_snapshot: "renter",
      },
      created_at: "2026-01-02T00:00:00.000Z",
    };
    const out = collapseLandlordBookingNotificationsByBookingId([pending, confirmed]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("c");
    expect(out[0].event_type).toBe("booking.confirmed");
  });
});
