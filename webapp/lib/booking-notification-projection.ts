import type { MessagingThreadSummary, NotificationItem, TenantBookingSummary } from "./api";
import { markBookingNotificationContextReadAndDispatch } from "./mark-booking-notification-context-read";
import type { MarkBookingContextReadResult } from "./mark-booking-notification-context-read";
import {
  classifyNotification,
  extractBookingNotificationShape,
  formatLandlordBookingEventLabel,
  isLandlordBookingNotificationRow,
  notificationBelongsToSurface,
  parseNotificationPayloadDeep,
  type NotificationClassification,
} from "./notification-booking";
import { renterLabelFromBookingPayload } from "./notification-booking-identity";
import {
  collapseLandlordBookingNotificationsByBookingId,
  dedupeNotificationFeed,
  applyBookingContextReadSyncToItems,
  mergeBookingContextDisplayNotification,
} from "./notification-dedupe-feed";
import { formatIdentityPriority } from "./user-display";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BookingNotificationRole = "tenant" | "landlord" | "unknown";

export type BookingUpdateProjection = {
  notification: NotificationItem;
  notificationId: string;
  bookingId: string;
  listingId: string;
  listingTitle: string;
  statusLabel: string;
  title: string;
  counterparty: string;
  role: BookingNotificationRole;
  roleLabel: string;
  href: string;
  isUnread: boolean;
  createdAt: string;
  classification: NotificationClassification;
};

export type BookingNotificationReadDetail = {
  notificationIds?: string[];
  bookingId?: string;
  audience?: BookingNotificationRole;
  readAt?: string;
};

export function isBookingNotificationItem(item: NotificationItem): boolean {
  const classification = classifyNotification(item);
  if (classification.category === "booking_renter" || classification.category === "booking_landlord") {
    return UUID_RE.test(classification.bookingId);
  }
  const et = classification.eventType.toLowerCase();
  if (et.startsWith("booking.") || et === "bookingrequestv1" || et === "bookingcreatedv1") {
    return UUID_RE.test(classification.bookingId);
  }
  return false;
}

export function dedupeBookingNotifications(
  items: NotificationItem[],
  opts?: { recipientUserId?: string },
): NotificationItem[] {
  const bookingOnly = items.filter(isBookingNotificationItem);
  return dedupeNotificationFeed(bookingOnly, opts);
}

/** Synthetic rows for active bookings missing from the notification feed (historical / replication gap). */
export function buildBookingFallbackNotifications(
  bookings: TenantBookingSummary[],
  existing: NotificationItem[],
  currentUserId: string,
): NotificationItem[] {
  const me = String(currentUserId || "").trim().toLowerCase();
  if (!me) return [];
  const covered = new Set<string>();
  for (const item of existing) {
    const classification = classifyNotification(item);
    if (UUID_RE.test(classification.bookingId)) covered.add(classification.bookingId);
  }
  const extras: NotificationItem[] = [];
  for (const b of bookings) {
    const bid = String(b.booking_id || b.id || "").trim().toLowerCase();
    if (!UUID_RE.test(bid) || covered.has(bid)) continue;
    const tenantId = String(b.tenant_id || "").trim().toLowerCase();
    const landlordId = String(b.landlord_id || "").trim().toLowerCase();
    const isLandlord = me === landlordId;
    const isTenant = me === tenantId;
    if (!isLandlord && !isTenant) continue;
    covered.add(bid);
    const st = String(b.status || "").trim().toUpperCase();
    let event_type = "booking.created";
    if (st === "ACCEPTED" || st === "PENDING_CONFIRMATION") event_type = "booking.accepted";
    else if (st === "CONFIRMED" || st === "COMPLETED") event_type = "booking.confirmed";
    else if (st === "REJECTED") event_type = "booking.rejected";
    else if (["CANCELLED", "CANCELED", "EXPIRED", "WITHDRAWN"].includes(st)) event_type = "booking.cancelled";

    extras.push({
      id: `local-booking-${bid}`,
      event_type,
      channel: "push",
      status: "pending",
      payload: {
        notification_audience: isLandlord ? "landlord" : "tenant",
        notification_category: isLandlord ? "booking_landlord" : "booking_renter",
        category: "booking",
        context_type: "booking",
        context_id: bid,
        booking_id: bid,
        listing_id: String(b.listing_id || ""),
        listing_title: b.listing_title ?? b.listing?.title ?? null,
        booking_status: st,
        tenant_username: b.renter_username ?? null,
        renter_display_name: b.renter_display_name ?? null,
        renter_username: b.renter_username ?? null,
        renter_display: b.renter_display ?? null,
        tenant_email: b.tenant_email ?? null,
        landlord_display: b.landlord_display ?? null,
        deep_link: `/dashboard/bookings/${encodeURIComponent(bid)}`,
        source: "webapp.messages.booking_fallback",
      },
      created_at: b.expires_at || `${b.startDate || "1970-01-01"}T12:00:00.000Z`,
    });
  }
  return extras;
}

export function mergeBookingNotificationsWithFallback(
  notifications: NotificationItem[],
  bookings: TenantBookingSummary[],
  opts?: { currentUserId?: string; coveredSource?: NotificationItem[] },
): NotificationItem[] {
  const userId = opts?.currentUserId ?? "";
  const coveredSource = opts?.coveredSource ?? notifications;
  const extras = buildBookingFallbackNotifications(bookings, coveredSource, userId);
  return dedupeBookingNotifications([...extras, ...notifications], {
    recipientUserId: userId || undefined,
  });
}

/** Landlord dashboard: booking notifications scoped to landlord surface + owned listings. */
export function filterLandlordBookingNotificationItems(
  items: NotificationItem[],
  opts?: { landlordListingIds?: Set<string> },
): NotificationItem[] {
  return items.filter((item) => {
    const classification = classifyNotification(item, {
      landlordListingIds: opts?.landlordListingIds,
    });
    return (
      notificationBelongsToSurface(item, "landlord", {
        landlordListingIds: opts?.landlordListingIds,
      }) &&
      classification.category === "booking_landlord" &&
      isLandlordBookingNotificationRow(item)
    );
  });
}

function applyBookingReadAtOverrides(
  items: NotificationItem[],
  readAtOverrides?: Record<string, string>,
): NotificationItem[] {
  if (!readAtOverrides || !Object.keys(readAtOverrides).length) return items;
  return items.map((item) => {
    if (item.read_at) return item;
    const bid = classifyNotification(item).bookingId;
    const override = bid ? readAtOverrides[bid] : undefined;
    if (override) return { ...item, read_at: override };
    return item;
  });
}

export function projectLandlordDashboardBookingRows(
  items: NotificationItem[],
  opts: {
    currentUserId: string;
    landlordMineBookings: TenantBookingSummary[];
    landlordListingIds?: Set<string>;
    readAtOverrides?: Record<string, string>;
    listingIdToTitle?: Map<string, string>;
  },
): BookingUpdateProjection[] {
  const my = String(opts.currentUserId || "").trim().toLowerCase();
  if (!my) return [];

  const landlordFeed = filterLandlordBookingNotificationItems(items, {
    landlordListingIds: opts.landlordListingIds,
  });
  const terminal = new Set(["REJECTED", "CANCELLED", "EXPIRED"]);
  const activeLandlordBookings = opts.landlordMineBookings.filter((b) => {
    if (String(b.landlord_id || "").trim().toLowerCase() !== my) return false;
    return !terminal.has(String(b.status || "").trim().toUpperCase());
  });

  let merged = mergeBookingNotificationsWithFallback(landlordFeed, activeLandlordBookings, {
    currentUserId: my,
    coveredSource: items.filter(isBookingNotificationItem),
  });
  merged = applyBookingReadAtOverrides(merged, opts.readAtOverrides);
  merged = applyBookingContextReadSyncToItems(
    merged.filter((item) => bookingNotificationRole(item, my) === "landlord"),
  );

  const rows = projectBookingNotificationRows(merged, {
    currentUserId: my,
    collapseByBookingId: false,
  });

  const titled = rows.map((row) => {
    const listingTitle =
      row.listingTitle ||
      (row.listingId ? opts.listingIdToTitle?.get(row.listingId) : undefined) ||
      (row.listingId ? `Listing ${row.listingId.slice(0, 8)}…` : "");
    return { ...row, listingTitle };
  });
  return syncBookingProjectionReadState(titled);
}

/** Same booking context: all lifecycle rows share read state; never flip unread when a sibling was read. */
export function syncBookingProjectionReadState(
  rows: BookingUpdateProjection[],
): BookingUpdateProjection[] {
  const byBooking = new Map<string, BookingUpdateProjection[]>();
  for (const row of rows) {
    const key = row.bookingId.toLowerCase();
    const group = byBooking.get(key) ?? [];
    group.push(row);
    byBooking.set(key, group);
  }
  const merged: BookingUpdateProjection[] = [];
  for (const group of Array.from(byBooking.values())) {
    const readTimes = group
      .map((row) => row.notification.read_at)
      .filter((v): v is string => Boolean(v))
      .sort();
    const contextReadAt = readTimes[0];
    for (const row of group) {
      const notification = contextReadAt
        ? { ...row.notification, read_at: contextReadAt }
        : row.notification;
      merged.push({
        ...row,
        notification,
        isUnread: !contextReadAt,
      });
    }
  }
  return merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/** @deprecated Prefer syncBookingProjectionReadState when showing multiple lifecycle rows per booking. */
export function dedupeBookingUpdateProjections(
  rows: BookingUpdateProjection[],
): BookingUpdateProjection[] {
  return syncBookingProjectionReadState(rows);
}

export function landlordDashboardCardTitle(
  projection: BookingUpdateProjection,
  bookingStatus?: string,
): string {
  const st = String(
    bookingStatus || projection.classification.bookingStatus || "",
  ).toUpperCase();
  if (st === "CANCELLED" || st === "CANCELED") return "Booking cancelled by renter";
  if (st === "CONFIRMED" || st === "COMPLETED") return "Confirmed booking on your listing";
  if (st === "ACCEPTED" || st === "PENDING_CONFIRMATION") return "Booking accepted — waiting for renter";
  if (projection.statusLabel === "Booking confirmed") return "Confirmed booking on your listing";
  if (projection.statusLabel === "Booking approved") return "Booking accepted — waiting for renter";
  return "New booking request";
}

export function landlordDashboardActionLabel(bookingStatus?: string): string {
  const st = String(bookingStatus || "").trim().toUpperCase();
  return st === "PENDING" ? "Respond" : "Open booking";
}

export function landlordDashboardBookingStatus(
  projection: BookingUpdateProjection,
  currentBookingStatusById?: Map<string, string>,
): string {
  const live = currentBookingStatusById?.get(projection.bookingId);
  if (live) return live;
  const fromPayload = String(projection.classification.bookingStatus || "").trim().toUpperCase();
  return fromPayload || "—";
}

export function landlordDashboardEventLabel(
  projection: BookingUpdateProjection,
  bookingStatus?: string,
): string {
  return formatLandlordBookingEventLabel(
    projection.notification.event_type || projection.statusLabel,
    bookingStatus || projection.classification.bookingStatus,
  );
}

/** One visible row per booking (lifecycle winner + merged identity). */
export function collapseBookingNotificationsByBookingId(items: NotificationItem[]): NotificationItem[] {
  const deduped = dedupeBookingNotifications(items);
  return collapseLandlordBookingNotificationsByBookingId(deduped);
}

export function bookingNotificationRole(
  item: NotificationItem,
  currentUserId?: string,
): BookingNotificationRole {
  const classification = classifyNotification(item);
  const payload = classification.payload;
  const audience = String(payload.notification_audience ?? "").trim().toLowerCase();
  const recipientRole = String(payload.notification_recipient_role ?? "").trim().toLowerCase();
  if (recipientRole === "landlord") return "landlord";
  if (recipientRole === "tenant" || recipientRole === "renter") return "tenant";
  if (audience === "tenant" || audience === "renter" || audience === "user") return "tenant";
  if (audience === "landlord") return "landlord";

  if (classification.category === "booking_renter") return "tenant";
  if (classification.category === "booking_landlord") return "landlord";

  const me = String(currentUserId ?? "").trim().toLowerCase();
  const tenantId = classification.tenantId || classification.renterId;
  const landlordId = classification.landlordId;
  if (me && tenantId && me === tenantId) return "tenant";
  if (me && landlordId && me === landlordId) return "landlord";

  const et = classification.eventType.toLowerCase();
  if (
    et === "booking.created" ||
    et === "booking.request" ||
    et === "booking.requested" ||
    et === "bookingrequestv1" ||
    et === "bookingcreatedv1"
  ) {
    return "landlord";
  }
  if (
    et === "booking.accepted" ||
    et === "booking.confirmed" ||
    et === "booking.rejected" ||
    et === "booking.cancelled" ||
    et === "booking.canceled" ||
    et === "booking.expired" ||
    et === "booking.withdrawn"
  ) {
    return "tenant";
  }
  return "unknown";
}

function bookingRoleLabel(role: BookingNotificationRole): string {
  if (role === "tenant") return "As renter";
  if (role === "landlord") return "As landlord";
  return "Booking update";
}

export function bookingNotificationStatusLabel(item: NotificationItem): string {
  const classification = classifyNotification(item);
  const et = classification.eventType.toLowerCase();
  const st = String(classification.bookingStatus || "").toUpperCase();

  if (et.includes("accept") || st === "ACCEPTED" || st === "PENDING_CONFIRMATION") {
    return "Booking approved";
  }
  if (et.includes("confirm") || st === "CONFIRMED" || st === "COMPLETED") {
    return "Booking confirmed";
  }
  if (et.includes("cancel") || st === "CANCELLED" || st === "CANCELED" || st === "WITHDRAWN") {
    return "Booking cancelled";
  }
  if (et.includes("reject") || st === "REJECTED" || st === "DECLINED") {
    return "Booking cancelled";
  }
  if (et.includes("expired") || st === "EXPIRED") {
    return "Booking cancelled";
  }
  if (
    et.includes("created") ||
    et.includes("request") ||
    st === "PENDING" ||
    st === "CREATED" ||
    et === "bookingrequestv1" ||
    et === "bookingcreatedv1"
  ) {
    return "Booking requested";
  }
  return "Booking update";
}

export function bookingNotificationTitle(projection: BookingUpdateProjection): string {
  return projection.statusLabel;
}

function landlordCounterpartyFromPayload(p: Record<string, unknown>): string {
  const line = formatIdentityPriority({
    username: String(p.landlord_username ?? p.landlordUsername ?? "").trim() || null,
    display_name:
      String(p.landlord_display_name ?? p.landlordDisplayName ?? p.landlord_display ?? "").trim() ||
      null,
    email: String(p.landlord_email ?? p.landlordEmail ?? "").trim() || null,
    id: String(p.landlord_id ?? p.landlordId ?? "").trim() || null,
  });
  return line === "—" ? "" : line;
}

export function bookingNotificationCounterparty(
  item: NotificationItem,
  role: BookingNotificationRole,
): string {
  const p = parseNotificationPayloadDeep(item);
  if (role === "landlord") {
    return renterLabelFromBookingPayload(p);
  }
  if (role === "tenant") {
    return landlordCounterpartyFromPayload(p);
  }
  const tenantSide = renterLabelFromBookingPayload(p);
  const hostSide = landlordCounterpartyFromPayload(p);
  return tenantSide || hostSide || "—";
}

export function bookingNotificationHref(
  item: NotificationItem,
  opts?: { role?: BookingNotificationRole; notificationId?: string },
): string {
  const classification = classifyNotification(item);
  const p = classification.payload;
  const { bookingId, deepLink } = extractBookingNotificationShape(item, p);
  if (!bookingId) return "";
  const role = opts?.role ?? bookingNotificationRole(item);
  const from = role === "landlord" ? "landlord" : role === "tenant" ? "tenant" : "notifications";
  const nid = String(opts?.notificationId ?? item.id ?? "").trim();
  const base =
    deepLink && deepLink.includes("/dashboard/bookings/")
      ? deepLink.split("?")[0]
      : `/dashboard/bookings/${encodeURIComponent(bookingId)}`;
  const params = new URLSearchParams();
  if (UUID_RE.test(nid)) params.set("nid", nid.toLowerCase());
  params.set("from", from);
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

export function projectBookingNotificationRow(
  item: NotificationItem,
  opts?: { currentUserId?: string },
): BookingUpdateProjection | null {
  if (!isBookingNotificationItem(item)) return null;
  const classification = classifyNotification(item);
  const p = classification.payload;
  const { bookingId } = extractBookingNotificationShape(item, p);
  if (!bookingId) return null;

  const role = bookingNotificationRole(item, opts?.currentUserId);
  const notificationId = UUID_RE.test(item.id) ? item.id.toLowerCase() : "";
  const listingTitle = String(p.listing_title ?? p.listingTitle ?? "").trim();
  const statusLabel = bookingNotificationStatusLabel(item);
  const counterparty = bookingNotificationCounterparty(item, role);
  const href = bookingNotificationHref(item, { role, notificationId });

  return {
    notification: item,
    notificationId,
    bookingId,
    listingId: classification.listingId,
    listingTitle,
    statusLabel,
    title: statusLabel,
    counterparty,
    role,
    roleLabel: bookingRoleLabel(role),
    href,
    isUnread: !item.read_at,
    createdAt: item.created_at,
    classification,
  };
}

export function projectBookingNotificationRows(
  items: NotificationItem[],
  opts?: { currentUserId?: string; collapseByBookingId?: boolean },
): BookingUpdateProjection[] {
  const deduped = opts?.collapseByBookingId
    ? collapseBookingNotificationsByBookingId(items)
    : dedupeBookingNotifications(items, { recipientUserId: opts?.currentUserId });
  const rows: BookingUpdateProjection[] = [];
  for (const item of deduped) {
    const row = projectBookingNotificationRow(item, { currentUserId: opts?.currentUserId });
    if (row) rows.push(row);
  }
  return rows.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function bookingProjectionsToThreadSummaries(
  projections: BookingUpdateProjection[],
): MessagingThreadSummary[] {
  return projections.map((row) => {
    const listingTitle = row.listingTitle || row.statusLabel;
    const previewParts = [row.roleLabel, row.counterparty, row.listingTitle].filter(Boolean);
    return {
      id: row.notificationId ? `notif:${row.notificationId}` : `booking:${row.bookingId}`,
      threadRole: "booking_update",
      bookingHref: row.href,
      listingTitle,
      participantDisplay: row.statusLabel,
      listingContextTitle: row.listingTitle || undefined,
      participantUsername: row.counterparty.replace(/^@/, "") || undefined,
      lastMessagePreview: previewParts.join(" · "),
      unreadCount: row.isUnread ? 1 : 0,
      lastAt: row.createdAt,
      listingId: row.listingId || undefined,
    };
  });
}

export function notificationItemMatchesBookingRead(
  item: NotificationItem,
  detail: BookingNotificationReadDetail,
): boolean {
  const ids = new Set(
    (detail.notificationIds ?? []).map((id) => String(id).trim().toLowerCase()).filter((id) => UUID_RE.test(id)),
  );
  if (ids.size > 0 && UUID_RE.test(item.id) && ids.has(item.id.toLowerCase())) {
    return true;
  }
  const bookingId = String(detail.bookingId || "").trim().toLowerCase();
  if (!bookingId || !isBookingNotificationItem(item)) return false;
  const classification = classifyNotification(item);
  const p = classification.payload;
  const contextId = String(p.context_id ?? "").trim().toLowerCase();
  const payloadBookingId = String(p.booking_id ?? p.bookingId ?? "").trim().toLowerCase();
  const href = bookingNotificationHref(item, {
    role: bookingNotificationRole(item),
    notificationId: item.id,
  });
  return (
    classification.bookingId === bookingId ||
    contextId === bookingId ||
    payloadBookingId === bookingId ||
    href.toLowerCase().includes(bookingId)
  );
}

export function applyBookingNotificationReadDetail(
  items: NotificationItem[],
  detail: BookingNotificationReadDetail,
): NotificationItem[] {
  const readAt = String(detail.readAt || new Date().toISOString());

  return items.map((item) => {
    if (item.read_at) return item;
    if (notificationItemMatchesBookingRead(item, detail)) {
      return { ...item, read_at: readAt };
    }
    return item;
  });
}

export function dispatchBookingNotificationReadEvents(detail: BookingNotificationReadDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("och:notifications-read", {
      detail: {
        notificationIds: detail.notificationIds ?? [],
        bookingId: detail.bookingId,
        audience: detail.audience,
        readAt: detail.readAt ?? new Date().toISOString(),
      },
    }),
  );
  window.dispatchEvent(new Event("och:badges-refresh"));
}

export async function openBookingNotificationFromProjection(
  token: string,
  projection: BookingUpdateProjection,
  handlers: {
    onLocalRead?: (readAt: string, result: MarkBookingContextReadResult) => void;
    navigate: (href: string) => void;
  },
): Promise<void> {
  if (projection.bookingId) {
    try {
      const result = await markBookingNotificationContextReadAndDispatch(token, {
        bookingId: projection.bookingId,
        notificationId: projection.notificationId || null,
        audience: projection.role,
      });
      handlers.onLocalRead?.(result.read_at, result);
    } catch {
      /* keep unread until mark-context-read succeeds */
    }
  }
  handlers.navigate(projection.href);
}

/** Re-export for landlord table collapse (single booking context merge). */
export { mergeBookingContextDisplayNotification };
