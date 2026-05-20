import { describe, expect, it } from "vitest";
import type { NotificationItem } from "./api";
import {
  applyBookingNotificationReadDetail,
  bookingNotificationHref,
  bookingNotificationRole,
  bookingNotificationTitle,
  bookingProjectionsToThreadSummaries,
  dedupeBookingNotifications,
  landlordDashboardCardTitle,
  projectBookingNotificationRows,
  landlordDashboardEventLabel,
  projectLandlordDashboardBookingRows,
} from "./booking-notification-projection";

const tenantUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const landlordUserId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bookingId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const tenantNotifId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const landlordNotifId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

function tenantAcceptedNotification(overrides?: Partial<NotificationItem>): NotificationItem {
  return {
    id: tenantNotifId,
    event_type: "booking.accepted",
    channel: "push",
    status: "pending",
    payload: {
      notification_audience: "tenant",
      notification_category: "booking_renter",
      booking_id: bookingId,
      listing_title: "Oak Lane 2BR",
      landlord_username: "host_jo",
    },
    created_at: "2026-05-01T10:00:00.000Z",
    user_id: tenantUserId,
    ...overrides,
  };
}

function landlordRequestNotification(overrides?: Partial<NotificationItem>): NotificationItem {
  return {
    id: landlordNotifId,
    event_type: "booking.created",
    channel: "push",
    status: "pending",
    payload: {
      notification_audience: "landlord",
      notification_category: "booking_landlord",
      booking_id: bookingId,
      listing_title: "Maple Hall",
      tenant_username: "renter_sam",
    },
    created_at: "2026-05-02T11:00:00.000Z",
    user_id: landlordUserId,
    ...overrides,
  };
}

describe("booking-notification-projection", () => {
  it("projects booking notifications into Messages Booking updates for tenant", () => {
    const rows = projectBookingNotificationRows([tenantAcceptedNotification()], {
      currentUserId: tenantUserId,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("tenant");
    expect(rows[0].roleLabel).toBe("As renter");
    expect(bookingNotificationTitle(rows[0])).toBe("Booking approved");
    const threads = bookingProjectionsToThreadSummaries(rows);
    expect(threads[0].id).toBe(`notif:${tenantNotifId}`);
    expect(threads[0].lastMessagePreview).toContain("As renter");
  });

  it("projects booking notifications into Messages Booking updates for landlord", () => {
    const rows = projectBookingNotificationRows([landlordRequestNotification()], {
      currentUserId: landlordUserId,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("landlord");
    expect(rows[0].roleLabel).toBe("As landlord");
    expect(rows[0].statusLabel).toBe("Booking requested");
    expect(rows[0].counterparty).toMatch(/renter_sam|@renter_sam/);
  });

  it("dedupes booking update rows but keeps enriched username", () => {
    const sparse: NotificationItem = {
      ...landlordRequestNotification(),
      id: "11111111-1111-4111-8111-111111111111",
      payload: {
        notification_audience: "landlord",
        notification_category: "booking_landlord",
        booking_id: bookingId,
        tenant_id: tenantUserId,
      },
      created_at: "2026-01-01T00:00:00.000Z",
      dedupe_key: "landlord:booking.created:booking:cccccccc-cccc-4ccc-8ccc-cccccccccccc:PENDING",
    };
    const enriched: NotificationItem = {
      ...sparse,
      id: "22222222-2222-4222-8222-222222222222",
      created_at: "2026-01-02T00:00:00.000Z",
      payload: {
        ...(sparse.payload as Record<string, unknown>),
        tenant_username: "renter_sam",
        listing_title: "Maple Hall",
      },
    };
    const deduped = dedupeBookingNotifications([enriched, sparse]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].id).toBe("22222222-2222-4222-8222-222222222222");
    const rows = projectBookingNotificationRows(deduped, { currentUserId: landlordUserId });
    expect(rows[0].counterparty).toMatch(/renter_sam|@renter_sam/);
  });

  it("click href includes booking id, nid, and from role", () => {
    const item = tenantAcceptedNotification();
    const href = bookingNotificationHref(item, { role: bookingNotificationRole(item, tenantUserId) });
    expect(href).toContain(`/dashboard/bookings/${bookingId}`);
    expect(href).toContain(`nid=${tenantNotifId}`);
    expect(href).toContain("from=tenant");
  });

  it("notifications-read event marks matching booking update row read", () => {
    const unread = tenantAcceptedNotification();
    const read = applyBookingNotificationReadDetail([unread], {
      bookingId,
      readAt: "2026-05-03T00:00:00.000Z",
    });
    expect(read[0].read_at).toBe("2026-05-03T00:00:00.000Z");
    const rows = projectBookingNotificationRows(read, { currentUserId: tenantUserId });
    expect(rows[0].isUnread).toBe(false);
  });

  it("landlord dashboard renders booking notifications through shared projection", () => {
    const bookingId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const listingId = "12121212-1212-4121-8121-121212121212";
    const landlordNotif: NotificationItem = {
      id: landlordNotifId,
      event_type: "booking.created",
      channel: "push",
      status: "pending",
      payload: {
        notification_audience: "landlord",
        notification_category: "booking_landlord",
        booking_id: bookingId,
        listing_id: listingId,
        listing_title: "Shared Projection Loft",
        tenant_username: "renter_proof",
      },
      created_at: "2026-05-10T12:00:00.000Z",
      user_id: landlordUserId,
    };
    const rows = projectLandlordDashboardBookingRows([landlordNotif], {
      currentUserId: landlordUserId,
      landlordMineBookings: [],
      landlordListingIds: new Set([listingId]),
      listingIdToTitle: new Map([[listingId, "Shared Projection Loft"]]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("landlord");
    expect(rows[0].listingTitle).toBe("Shared Projection Loft");
    expect(rows[0].counterparty).toMatch(/renter_proof|@renter_proof/);
    expect(rows[0].href).toContain(`from=landlord`);
    expect(rows[0].href).toContain(bookingId);
    expect(landlordDashboardCardTitle(rows[0], "PENDING")).toBe("New booking request");
  });

  it("shows landlord-cancelled booking when notification_recipient_role is landlord", () => {
    const cancelled: NotificationItem = {
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      event_type: "booking.cancelled",
      channel: "push",
      status: "pending",
      user_id: landlordUserId,
      created_at: "2026-05-13T18:00:00.000Z",
      payload: {
        notification_audience: "landlord",
        notification_category: "booking_landlord",
        notification_recipient_role: "landlord",
        booking_id: bookingId,
        listing_id: "12121212-1212-4121-8121-121212121212",
        booking_status: "CANCELLED",
        new_status: "CANCELLED",
        tenant_username_snapshot: "tomwang04312",
        listing_title: "2 room apt",
      },
    };
    expect(bookingNotificationRole(cancelled, landlordUserId)).toBe("landlord");
    const rows = projectLandlordDashboardBookingRows([cancelled], {
      currentUserId: landlordUserId,
      landlordMineBookings: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe("landlord");
    expect(landlordDashboardCardTitle(rows[0], "CANCELLED")).toBe("Booking cancelled by renter");
  });

  it("collapses duplicate confirmed rows with different dedupe_key to one landlord row", () => {
    const bookingId = "65817e88-4996-4dc9-980c-dcdeb1f739bf";
    const listingId = "12121212-1212-4121-8121-121212121212";
    const base = {
      event_type: "booking.confirmed",
      channel: "push" as const,
      status: "pending",
      payload: {
        notification_audience: "landlord",
        notification_category: "booking_landlord",
        booking_id: bookingId,
        context_id: bookingId,
        listing_id: listingId,
        booking_status: "CONFIRMED",
        tenant_username: "tomwang04312",
      },
    };
    const older: NotificationItem = {
      ...base,
      id: "c8694d44-450f-4ae7-b7c2-cb645d75a6f6",
      created_at: "2026-05-15T04:02:37.899Z",
      read_at: "2026-05-15T04:04:39.062Z",
      dedupe_key: `booking:${landlordUserId}:${bookingId}:confirmed`,
    };
    const newer: NotificationItem = {
      ...base,
      id: "07e6bf67-93e4-44bb-9f26-d46051eecc2f",
      created_at: "2026-05-17T17:07:52.439Z",
      read_at: undefined,
      dedupe_key: `booking:${landlordUserId}:${bookingId}:confirmed:dup`,
    };
    const rows = projectLandlordDashboardBookingRows([older, newer], {
      currentUserId: landlordUserId,
      landlordMineBookings: [],
      landlordListingIds: new Set([listingId]),
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((row) => !row.isUnread)).toBe(true);
    const read = applyBookingNotificationReadDetail([older, newer], {
      bookingId,
      readAt: "2026-05-18T00:00:00.000Z",
    });
    const afterRead = projectLandlordDashboardBookingRows(read, {
      currentUserId: landlordUserId,
      landlordMineBookings: [],
      landlordListingIds: new Set([listingId]),
    });
    expect(afterRead.every((row) => !row.isUnread)).toBe(true);
  });

  it("shows confirmed and cancelled lifecycle rows with shared read state", () => {
    const confirmed: NotificationItem = {
      id: "11111111-1111-4111-8111-111111111111",
      event_type: "booking.confirmed",
      channel: "push",
      status: "pending",
      created_at: "2026-05-15T04:02:37.899Z",
      read_at: undefined,
      payload: {
        notification_audience: "landlord",
        notification_category: "booking_landlord",
        booking_id: bookingId,
        booking_status: "CONFIRMED",
      },
    };
    const cancelled: NotificationItem = {
      id: "22222222-2222-4222-8222-222222222222",
      event_type: "booking.cancelled",
      channel: "push",
      status: "pending",
      created_at: "2026-05-16T00:00:00.000Z",
      read_at: "2026-05-16T01:00:00.000Z",
      payload: {
        notification_audience: "landlord",
        notification_category: "booking_landlord",
        booking_id: bookingId,
        booking_status: "CANCELLED",
      },
    };
    const rows = projectLandlordDashboardBookingRows([confirmed, cancelled], {
      currentUserId: landlordUserId,
      landlordMineBookings: [],
      landlordListingIds: new Set(),
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => !row.isUnread)).toBe(true);
    expect(rows.map((row) => row.notification.event_type).sort()).toEqual([
      "booking.cancelled",
      "booking.confirmed",
    ]);
    const confirmedRow = rows.find((row) => row.notification.event_type === "booking.confirmed");
    const cancelledRow = rows.find((row) => row.notification.event_type === "booking.cancelled");
    expect(landlordDashboardEventLabel(confirmedRow!, "CONFIRMED")).toBe("Booking confirmed");
    expect(landlordDashboardEventLabel(cancelledRow!, "CANCELLED")).toBe("Booking cancelled");
  });

  it("context mark-read clears duplicate/superseded booking rows", () => {
    const a = landlordRequestNotification({ id: "a", read_at: undefined });
    const b = landlordRequestNotification({
      id: "b",
      event_type: "booking.confirmed",
      payload: {
        notification_audience: "landlord",
        notification_category: "booking_landlord",
        booking_id: bookingId,
        tenant_username: "renter_sam",
        booking_status: "CONFIRMED",
      },
      created_at: "2026-05-03T12:00:00.000Z",
    });
    const read = applyBookingNotificationReadDetail([a, b], {
      bookingId,
      readAt: "2026-05-04T00:00:00.000Z",
    });
    expect(read.every((row) => row.read_at)).toBe(true);
  });
});
