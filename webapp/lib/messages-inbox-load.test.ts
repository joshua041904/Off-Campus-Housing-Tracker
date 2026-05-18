import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessagingThreadSummary, NotificationItem, TenantBookingSummary } from "./api";
import {
  loadBookingUpdatesForUser,
  loadMessagingThreadsForUser,
  markInboxLoadedForUser,
  shouldClearInboxForAuthChange,
} from "./messages-inbox-load";

vi.mock("./api", () => ({
  listMessagingThreads: vi.fn(),
  listNotifications: vi.fn(),
  listMyBookings: vi.fn(),
}));

import { listMessagingThreads, listNotifications, listMyBookings } from "./api";

const userA = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const userB = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff";

describe("messages inbox load", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    markInboxLoadedForUser(userA);
  });

  it("loads booking updates after auth token becomes available after mount", async () => {
    const thread: MessagingThreadSummary = {
      id: "notif:n1",
      listingTitle: "Booking",
      lastMessagePreview: "Booking request",
      lastAt: new Date().toISOString(),
      unreadCount: 1,
    };
    vi.mocked(listMessagingThreads).mockResolvedValue({ threads: [], bookingUpdates: [thread] });

    const notif: NotificationItem = {
      id: "11111111-2222-4333-8444-555555555555",
      event_type: "booking.created",
      channel: "in_app",
      status: "delivered",
      created_at: new Date().toISOString(),
      read_at: null,
      payload: {
        booking_id: "9ca45bd0-aaef-427d-aa95-3b6a7e0da937",
        booking_status: "PENDING",
        listing_id: "1b235322-10e5-4cfb-8594-6565e67e28e9",
      },
    };
    vi.mocked(listNotifications).mockResolvedValue([notif]);
    vi.mocked(listMyBookings).mockResolvedValue([] as TenantBookingSummary[]);

    const threadsResult = await loadMessagingThreadsForUser("token-a", "auth-ready");
    expect(threadsResult.threads).toEqual([]);
    expect(threadsResult.serverBookingUpdates).toHaveLength(1);

    const bookingResult = await loadBookingUpdatesForUser("token-a", userA, threadsResult.serverBookingUpdates, "auth-ready");
    expect(bookingResult.bookingUpdates.length).toBeGreaterThan(0);
    expect(bookingResult.warnings).toEqual([]);
  });

  it("merges booking updates when one upstream call fails", async () => {
    vi.mocked(listNotifications).mockRejectedValue(new Error("notifications down"));
    vi.mocked(listMyBookings).mockResolvedValue([
      {
        booking_id: "9ca45bd0-aaef-427d-aa95-3b6a7e0da937",
        listing_id: "1b235322-10e5-4cfb-8594-6565e67e28e9",
        status: "PENDING",
        startDate: "2026-06-01",
        endDate: "2026-08-01",
        duration_days: 60,
        expires_at: new Date().toISOString(),
        tenant_id: userA,
        landlord_id: "cccccccc-dddd-eeee-ffff-000011112222",
      },
    ] satisfies TenantBookingSummary[]);

    const result = await loadBookingUpdatesForUser("token-a", userA, [], "auth-ready");
    expect(result.warnings.length).toBe(1);
    expect(result.bookingUpdates.length).toBeGreaterThan(0);
  });

  it("does not cache unauthenticated empty result across login", () => {
    expect(shouldClearInboxForAuthChange(null)).toBe(true);
    markInboxLoadedForUser(userA);
    expect(shouldClearInboxForAuthChange(userB)).toBe(true);
    markInboxLoadedForUser(userB);
    expect(shouldClearInboxForAuthChange(userB)).toBe(false);
  });
});
