import type { MessagingThreadSummary, NotificationItem } from "./api";
import {
  bookingProjectionsToThreadSummaries,
  projectBookingNotificationRows,
} from "./booking-notification-projection";

/** Map booking-category notifications into synthetic inbox rows for Messages → Booking updates. */
export function bookingNotificationsToThreadSummaries(
  items: NotificationItem[],
  opts?: { recipientUserId?: string },
): MessagingThreadSummary[] {
  const projections = projectBookingNotificationRows(items, {
    currentUserId: opts?.recipientUserId,
    collapseByBookingId: false,
  });
  return bookingProjectionsToThreadSummaries(projections);
}
