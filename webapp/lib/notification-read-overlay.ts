import type { NotificationItem } from "./api";
import { isBookingNotificationItem } from "./booking-notification-projection";
import { classifyNotification } from "./notification-booking";

export type ReadOverlay = {
  notificationIds: Set<string>;
  bookingIds: Map<string, string>;
};

const overlay: ReadOverlay = {
  notificationIds: new Set(),
  bookingIds: new Map(),
};

export function getReadOverlay(): ReadOverlay {
  return overlay;
}

/** Session-only optimistic state; cleared on logout so API read_at is authoritative. */
export function clearReadOverlay(): void {
  overlay.notificationIds.clear();
  overlay.bookingIds.clear();
}

export function recordNotificationReadOverlay(detail: {
  notificationIds?: string[];
  bookingId?: string;
  readAt?: string;
}): void {
  const readAt = String(detail.readAt || new Date().toISOString());
  for (const id of detail.notificationIds ?? []) {
    const nid = String(id || "").trim().toLowerCase();
    if (nid) overlay.notificationIds.add(nid);
  }
  const bookingId = String(detail.bookingId || "").trim().toLowerCase();
  if (bookingId) overlay.bookingIds.set(bookingId, readAt);
}

export function applyReadOverlayToNotificationItems(items: NotificationItem[]): NotificationItem[] {
  if (!overlay.notificationIds.size && !overlay.bookingIds.size) return items;
  return items.map((item) => {
    if (item.read_at) return item;
    const id = String(item.id || "").trim().toLowerCase();
    if (id && overlay.notificationIds.has(id)) {
      const readAt =
        overlay.bookingIds.get(classifyNotification(item).bookingId) ??
        new Date().toISOString();
      return { ...item, read_at: readAt };
    }
    if (!isBookingNotificationItem(item)) return item;
    const classification = classifyNotification(item);
    const bookingId = classification.bookingId;
    const readAt = bookingId ? overlay.bookingIds.get(bookingId) : undefined;
    if (readAt) return { ...item, read_at: readAt };
    return item;
  });
}

export function applyReadOverlayToBookingProjection<T extends { bookingId: string; isUnread: boolean; notificationId?: string }>(
  rows: T[],
): T[] {
  if (!overlay.notificationIds.size && !overlay.bookingIds.size) return rows;
  return rows.map((row) => {
    const bookingId = String(row.bookingId || "").trim().toLowerCase();
    const nid = String(row.notificationId || "").trim().toLowerCase();
    if (overlay.bookingIds.has(bookingId) || (nid && overlay.notificationIds.has(nid))) {
      return { ...row, isUnread: false };
    }
    return row;
  });
}

export function countUnreadWithOverlay(
  items: NotificationItem[],
  predicate: (item: NotificationItem) => boolean,
): number {
  return applyReadOverlayToNotificationItems(items).filter((item) => predicate(item) && !item.read_at).length;
}
