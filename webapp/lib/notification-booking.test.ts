import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { NotificationItem } from "./api";
import {
  buildBookingDetailNotificationReadPlan,
  classifyNotification,
  notificationBelongsToSurface,
  notificationHrefForSurface,
  shouldIncludeLandlordBookingFallbackRow,
  normalizeLandlordBookingNotification,
  parseNotificationPayloadDeep,
} from "./notification-booking";

function makeNotification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: randomUUID(),
    event_type: "booking.created",
    channel: "push",
    status: "pending",
    payload: {},
    created_at: new Date("2026-05-13T19:00:00.000Z").toISOString(),
    read_at: null,
    ...overrides,
  };
}

describe("notification-booking", () => {
  it("builds a booking-detail mark-read plan from ?nid and matching booking notifications", () => {
    const bookingId = randomUUID();
    const notificationId = randomUUID();
    const plan = buildBookingDetailNotificationReadPlan({
      role: "landlord",
      bookingId,
      search: `?nid=${notificationId}`,
      notifications: [
        makeNotification({
          id: notificationId,
          event_type: "booking.created",
          payload: { booking_id: bookingId },
        }),
      ],
    });

    expect(plan.explicitNotificationId).toBe(notificationId);
    expect(plan.bulkIds).toEqual([notificationId]);
  });

  it("prefers live booking status so confirmed rows render as open, not pending", () => {
    const bookingId = randomUUID();
    const row = normalizeLandlordBookingNotification(
      makeNotification({
        event_type: "booking.created",
        payload: {
          booking_id: bookingId,
          listing_title: "Campus loft",
          tenant_username_snapshot: "tomwang04312_507ab69b2d",
          booking_status: "PENDING",
        },
      }),
      new Map(),
      new Map([[bookingId, "CONFIRMED"]]),
    );

    expect(row.bookingStatus).toBe("CONFIRMED");
    expect(row.actionLabel).toBe("Open");
    expect(row.cardTitle).toBe("Confirmed booking on your listing");
    expect(row.renterLabel).toBe("@tomwang04312");
  });

  it("uses the real notification id for synthetic landlord fallback rows", () => {
    const bookingId = randomUUID();
    const notificationId = randomUUID();
    const row = normalizeLandlordBookingNotification(
      makeNotification({
        id: `local-booking-${bookingId}`,
        payload: {
          booking_id: bookingId,
          notification_id: notificationId,
          deep_link: `/dashboard/bookings/${bookingId}`,
          booking_status: "PENDING",
        },
      }),
    );

    expect(row.href).toBe(`/dashboard/bookings/${bookingId}?nid=${notificationId}&role=landlord&from=landlord`);
    expect(row.actionLabel).toBe("Respond");
  });

  it("does not render synthetic landlord fallback rows when no real notification id exists", () => {
    const bookingId = randomUUID();
    const item = makeNotification({
      id: `local-booking-${bookingId}`,
      payload: {
        booking_id: bookingId,
        deep_link: `/dashboard/bookings/${bookingId}`,
        source: "webapp.dashboard.booking_fallback",
      },
    });

    expect(shouldIncludeLandlordBookingFallbackRow?.(item)).toBe(false);
  });

  it("allows synthetic landlord fallback rows when a real notification id exists", () => {
    const bookingId = randomUUID();
    const notificationId = randomUUID();
    const item = makeNotification({
      id: `local-booking-${bookingId}`,
      payload: {
        booking_id: bookingId,
        notification_id: notificationId,
        deep_link: `/dashboard/bookings/${bookingId}`,
        source: "webapp.dashboard.booking_fallback",
      },
    });

    expect(shouldIncludeLandlordBookingFallbackRow?.(item)).toBe(true);
  });

  it("parses nested stringified payload data", () => {
    const bookingId = randomUUID();
    const item = makeNotification({
      payload: JSON.stringify({
        payload: JSON.stringify({
          booking_id: bookingId,
          tenant_username_snapshot: "nested_user",
        }),
      }),
    });

    expect(parseNotificationPayloadDeep(item)).toMatchObject({
      booking_id: bookingId,
      tenant_username_snapshot: "nested_user",
    });
  });

  it("classifies landlord booking request rows into the landlord surface", () => {
    const listingId = randomUUID();
    const bookingId = randomUUID();
    const item = makeNotification({
      event_type: "booking.created",
      payload: {
        booking_id: bookingId,
        listing_id: listingId,
        landlord_id: randomUUID(),
        tenant_id: randomUUID(),
        booking_status: "PENDING",
        notification_audience: "landlord",
        notification_category: "booking_landlord",
      },
    });

    expect(classifyNotification(item, { landlordListingIds: new Set([listingId]) })).toMatchObject({
      audience: "landlord",
      category: "booking_landlord",
      bookingId,
      listingId,
    });
    expect(notificationHrefForSurface(item, "landlord")).toContain(`role=landlord`);
  });

  it("classifies renter booking updates into the primary user inbox", () => {
    const bookingId = randomUUID();
    const item = makeNotification({
      event_type: "booking.accepted",
      payload: {
        booking_id: bookingId,
        tenant_id: randomUUID(),
        landlord_id: randomUUID(),
        booking_status: "ACCEPTED",
        notification_audience: "user",
        notification_category: "booking_renter",
      },
    });

    expect(classifyNotification(item)).toMatchObject({
      audience: "user",
      category: "booking_renter",
      bookingId,
      bookingStatus: "ACCEPTED",
    });
    expect(notificationHrefForSurface(item, "user")).toBe(
      `/dashboard/bookings/${bookingId}?nid=${item.id}&from=notifications`,
    );
  });

  it("keeps landlord-only booking workflow rows out of the global inbox", () => {
    const listingId = randomUUID();
    const item = makeNotification({
      event_type: "booking.confirmed",
      payload: {
        booking_id: randomUUID(),
        listing_id: listingId,
      },
    });

    expect(notificationBelongsToSurface(item, "landlord", { landlordListingIds: new Set([listingId]) })).toBe(true);
    expect(notificationBelongsToSurface(item, "user", { landlordListingIds: new Set([listingId]) })).toBe(false);
  });

  it("routes landlord-flair community replies to both landlord and global inbox surfaces", () => {
    const item = makeNotification({
      event_type: "community.reply.notification",
      payload: {
        post_id: randomUUID(),
        post_flair: "landlord",
        deep_link: "/community/post-1?comment=2",
      },
    });

    expect(classifyNotification(item)).toMatchObject({
      audience: "both",
      category: "community",
    });
    expect(notificationBelongsToSurface(item, "landlord")).toBe(true);
    expect(notificationBelongsToSurface(item, "user")).toBe(true);
  });
});
