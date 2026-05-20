// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { NotificationItem } from "./api";
import {
  applyBookingNotificationReadDetail,
  notificationItemMatchesBookingRead,
} from "./booking-notification-projection";

const bookingId = "aeb9eabb-200c-4e54-9c2f-c86d5161fe57";
const landlordUserId = "d9206c11-7afd-41bd-8b53-f85410f473b4";

function bookingNotif(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: overrides.id ?? "11111111-1111-4111-8111-111111111111",
    event_type: overrides.event_type ?? "booking.confirmed",
    channel: "push",
    status: "pending",
    created_at: overrides.created_at ?? "2026-05-15T00:00:00.000Z",
    payload: {
      category: "booking",
      context_id: bookingId,
      booking_id: bookingId,
      notification_audience: "landlord",
      notification_category: "booking_landlord",
      ...(overrides.payload as Record<string, unknown> | undefined),
    },
    ...overrides,
  };
}

describe("notificationItemMatchesBookingRead", () => {
  it("matches by booking id across payload shapes", () => {
    const item = bookingNotif({
      id: "22222222-2222-4222-8222-222222222222",
      payload: { bookingId, category: "booking" },
    });
    expect(
      notificationItemMatchesBookingRead(item, {
        bookingId,
        readAt: "2026-05-16T00:00:00.000Z",
      }),
    ).toBe(true);
  });
});

describe("applyBookingNotificationReadDetail", () => {
  it("marks duplicate booking rows read by booking id", () => {
    const a = bookingNotif({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", read_at: "2026-05-14T00:00:00.000Z" });
    const b = bookingNotif({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      created_at: "2026-05-13T00:00:00.000Z",
    });
    const next = applyBookingNotificationReadDetail([a, b], {
      bookingId,
      notificationIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
      readAt: "2026-05-16T00:00:00.000Z",
    });
    expect(next.every((row) => row.read_at)).toBe(true);
  });
});

describe("markBookingNotificationContextRead", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("dispatches all notification ids returned by context-read", async () => {
    vi.doMock("./api", () => ({
      markBookingNotificationContextReadApi: vi.fn(async () => ({
        ok: true,
        booking_id: bookingId,
        read_at: "2026-05-16T12:00:00.000Z",
        affected_rows: 2,
        notification_ids: [
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        ],
        updated: 1,
      })),
      markNotificationRead: vi.fn(),
    }));
    const events: CustomEvent[] = [];
    const orig = window.dispatchEvent;
    window.dispatchEvent = ((ev: Event) => {
      events.push(ev as CustomEvent);
      return orig.call(window, ev);
    }) as typeof window.dispatchEvent;

    const { markBookingNotificationContextReadAndDispatch } = await import(
      "./mark-booking-notification-context-read"
    );
    await markBookingNotificationContextReadAndDispatch("tok", {
      bookingId,
      notificationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    const readEv = events.find((e) => e.type === "och:notifications-read") as CustomEvent | undefined;
    expect(readEv?.detail?.notificationIds).toHaveLength(2);
    expect(readEv?.detail?.bookingId).toBe(bookingId);
  });

  it("dispatches read overlay when API returns booking id but no ids", async () => {
    vi.doMock("./api", () => ({
      markBookingNotificationContextReadApi: vi.fn(async () => ({
        ok: true,
        booking_id: bookingId,
        read_at: "2026-05-16T12:00:00.000Z",
        affected_rows: 0,
        notification_ids: [],
        updated: 0,
      })),
    }));
    const events: CustomEvent[] = [];
    const orig = window.dispatchEvent;
    window.dispatchEvent = ((ev: Event) => {
      events.push(ev as CustomEvent);
      return orig.call(window, ev);
    }) as typeof window.dispatchEvent;

    const { markBookingNotificationContextReadAndDispatch } = await import(
      "./mark-booking-notification-context-read"
    );
    await markBookingNotificationContextReadAndDispatch("tok", { bookingId });
    const readEv = events.find((e) => e.type === "och:notifications-read") as CustomEvent | undefined;
    expect(readEv?.detail?.bookingId).toBe(bookingId);
  });
});
