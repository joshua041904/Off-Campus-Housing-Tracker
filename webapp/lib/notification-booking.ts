import type { NotificationItem } from "./api";
import { renterLabelFromBookingPayload } from "./notification-booking-identity";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function appendQueryParams(href: string, entries: Array<[string, string]>): string {
  const raw = String(href || "").trim();
  if (!raw) return "";
  const [pathname, hash = ""] = raw.split("#", 2);
  const [basePath, search = ""] = pathname.split("?", 2);
  const params = new URLSearchParams(search);
  for (const [key, value] of entries) {
    if (String(value || "").trim()) {
      params.set(key, value);
    }
  }
  const nextSearch = params.toString();
  return `${basePath}${nextSearch ? `?${nextSearch}` : ""}${hash ? `#${hash}` : ""}`;
}

/** Normalize notification.payload: object, stringified JSON, nested `data` / `payload` strings. */
export function parseNotificationPayloadDeep(item: NotificationItem): Record<string, unknown> {
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => ({ ...a, ...b });
  const parseOne = (raw: unknown): Record<string, unknown> => {
    if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
    if (typeof raw === "string") {
      try {
        const j = JSON.parse(raw) as unknown;
        if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>;
      } catch {
        /* ignore */
      }
    }
    return {};
  };

  let p = parseOne(item.payload as unknown);
  const nestedData = p.data;
  if (typeof nestedData === "string" || (nestedData && typeof nestedData === "object")) {
    p = merge(p, parseOne(nestedData));
  }
  const nestedPayload = p.payload;
  if (typeof nestedPayload === "string" || (nestedPayload && typeof nestedPayload === "object")) {
    p = merge(p, parseOne(nestedPayload));
  }
  return p;
}

function bookingIdFromDeepLink(dl: string): string {
  const m = dl.match(/\/dashboard\/bookings\/([0-9a-f-]{36})/i);
  return m?.[1] ? m[1].toLowerCase() : "";
}

/** Top-level or payload-embedded event type (some gateways/clients misplace it). */
export function effectiveNotificationEventType(item: NotificationItem): string {
  const top = String(item.event_type ?? "").trim();
  if (top) return top;
  const p = parseNotificationPayloadDeep(item);
  return String(p.event_type ?? p.event ?? p.type ?? "").trim();
}

/** Extract booking / listing identifiers used by landlord + renter UIs. */
export function extractBookingNotificationShape(
  item: NotificationItem,
  p: Record<string, unknown>,
): {
  bookingId: string;
  listingId: string;
  renterId: string;
  deepLink: string;
} {
  let bookingId = String(p.bookingId ?? p.booking_id ?? "").trim().toLowerCase();
  const listingId = String(p.listingId ?? p.listing_id ?? "").trim().toLowerCase();
  const renterId = String(
    p.renterId ?? p.renter_id ?? p.tenantId ?? p.tenant_id ?? p.guest_id ?? p.guestId ?? "",
  )
    .trim()
    .toLowerCase();
  let deepLink = String(p.deep_link ?? p.deepLink ?? "").trim();
  if (!bookingId && deepLink) {
    const fromDl = bookingIdFromDeepLink(deepLink);
    if (fromDl) bookingId = fromDl;
  }
  if (!deepLink && bookingId && UUID_RE.test(bookingId)) {
    deepLink = `/dashboard/bookings/${encodeURIComponent(bookingId)}`;
  }
  const rawPreview = String(p.raw_preview ?? p.preview ?? "");
  if (!bookingId && rawPreview.length > 10) {
    try {
      const inner = JSON.parse(rawPreview) as { payload?: Record<string, unknown> };
      const ip = inner.payload && typeof inner.payload === "object" ? inner.payload : null;
      if (ip) {
        const bid = String(ip.booking_id ?? ip.bookingId ?? "").trim().toLowerCase();
        if (UUID_RE.test(bid)) bookingId = bid;
      }
    } catch {
      const m = rawPreview.match(/"booking_id"\s*:\s*"([0-9a-f-]{36})"/i);
      if (m?.[1]) bookingId = m[1].toLowerCase();
    }
  }
  return { bookingId, listingId, renterId, deepLink };
}

export const LANDLORD_BOOKING_EVENTS = new Set([
  "booking.created",
  "booking.requested",
  "booking.request",
  "booking.accepted",
  "booking.confirmed",
  "booking.cancelled",
  "booking.canceled",
  "booking.rejected",
  "booking.withdrawn",
  "booking.expired",
  "BookingRequestV1",
  "BookingCreatedV1",
  "booking.status.updated",
]);

const BOOKING_LIKE_EVENTS = new Set([
  ...Array.from(LANDLORD_BOOKING_EVENTS),
  "booking.accepted",
  "booking.confirmed",
  "booking.rejected",
  "booking.cancelled",
  "booking.canceled",
  "booking.withdrawn",
  "booking.expired",
]);

const LANDLORD_COMMUNITY_FLAIRS = new Set(["landlord"]);

export type NotificationAudience = "user" | "landlord" | "both";

export type NotificationCategory =
  | "booking_renter"
  | "booking_landlord"
  | "community"
  | "message"
  | "watchlist"
  | "system";

type NotificationSurface = "user" | "landlord";

type NotificationClassificationOptions = {
  landlordListingIds?: ReadonlySet<string>;
};

export type NotificationClassification = {
  audience: NotificationAudience;
  category: NotificationCategory;
  eventType: string;
  bookingId: string;
  listingId: string;
  renterId: string;
  tenantId: string;
  landlordId: string;
  bookingStatus: string;
  deepLink: string;
  payload: Record<string, unknown>;
};

function parseNotificationAudience(raw: unknown): NotificationAudience | null {
  const audience = String(raw || "").trim().toLowerCase();
  if (audience === "tenant" || audience === "renter") return "user";
  if (audience === "user" || audience === "landlord" || audience === "both") return audience;
  return null;
}

function parseNotificationCategory(raw: unknown): NotificationCategory | null {
  const category = String(raw || "").trim().toLowerCase();
  switch (category) {
    case "booking":
    case "booking_renter":
    case "booking_landlord":
    case "community":
    case "message":
    case "watchlist":
    case "system":
      return category === "booking" ? null : category;
    default:
      return null;
  }
}

function notificationRecipientRole(payload: Record<string, unknown>): string {
  return String(payload.notification_recipient_role ?? payload.recipient_role ?? "").trim().toLowerCase();
}

function postFlair(payload: Record<string, unknown>): string {
  return String(payload.post_flair ?? payload.flair ?? "").trim().toLowerCase();
}

function isLandlordCommunityNotification(
  payload: Record<string, unknown>,
  options: NotificationClassificationOptions,
  listingId: string,
): boolean {
  return LANDLORD_COMMUNITY_FLAIRS.has(postFlair(payload)) || (listingId ? options.landlordListingIds?.has(listingId) === true : false);
}

function isMessageEvent(eventType: string, payload: Record<string, unknown>): boolean {
  const lower = eventType.toLowerCase();
  const source = String(payload.source || "").trim().toLowerCase();
  return (
    lower.includes("message") ||
    lower.includes("dm") ||
    lower.includes("thread") ||
    source.includes("message") ||
    source.includes("dm")
  );
}

function isWatchlistEvent(eventType: string, payload: Record<string, unknown>): boolean {
  const lower = eventType.toLowerCase();
  const source = String(payload.source || "").trim().toLowerCase();
  return lower.includes("watchlist") || lower.includes("saved_search") || source.includes("watchlist") || source.includes("saved-search");
}

function bookingCategoryFromLegacyShape(
  eventType: string,
  payload: Record<string, unknown>,
  bookingStatus: string,
  options: NotificationClassificationOptions,
  listingId: string,
): { audience: NotificationAudience; category: NotificationCategory } | null {
  const recipientRole = notificationRecipientRole(payload);
  if (recipientRole === "landlord") return { audience: "landlord", category: "booking_landlord" };
  if (recipientRole === "tenant" || recipientRole === "renter" || recipientRole === "user") {
    return { audience: "user", category: "booking_renter" };
  }
  if (listingId && options.landlordListingIds?.has(listingId) && LANDLORD_BOOKING_EVENTS.has(eventType)) {
    return { audience: "landlord", category: "booking_landlord" };
  }
  if (
    eventType === "booking.created" ||
    eventType === "booking.request" ||
    eventType === "booking.requested" ||
    eventType === "BookingRequestV1" ||
    eventType === "BookingCreatedV1"
  ) {
    return { audience: "landlord", category: "booking_landlord" };
  }
  if (
    eventType === "booking.accepted" ||
    eventType === "booking.confirmed" ||
    eventType === "booking.rejected" ||
    eventType === "booking.cancelled" ||
    eventType === "booking.canceled" ||
    eventType === "booking.expired" ||
    eventType === "booking.withdrawn"
  ) {
    return { audience: "user", category: "booking_renter" };
  }
  if (eventType === "booking.status.updated") {
    if (bookingStatus === "PENDING" || bookingStatus === "CREATED") {
      return { audience: "landlord", category: "booking_landlord" };
    }
    if (bookingStatus) {
      return { audience: "user", category: "booking_renter" };
    }
  }
  return null;
}

export function classifyNotification(
  item: NotificationItem,
  options: NotificationClassificationOptions = {},
): NotificationClassification {
  const payload = parseNotificationPayloadDeep(item);
  const shape = extractBookingNotificationShape(item, payload);
  const eventType = effectiveNotificationEventType(item);
  const bookingStatus = canonicalBookingStatus(
    String(payload.booking_status ?? payload.new_status ?? payload.newStatus ?? item.status ?? ""),
  );
  const listingId = shape.listingId;
  const tenantId = String(payload.tenant_id ?? payload.tenantId ?? payload.renter_id ?? payload.renterId ?? "").trim().toLowerCase();
  const landlordId = String(payload.landlord_id ?? payload.landlordId ?? "").trim().toLowerCase();
  const explicitAudience = parseNotificationAudience(payload.notification_audience);
  const explicitCategory = parseNotificationCategory(payload.notification_category);
  let audience: NotificationAudience = explicitAudience ?? "user";
  let category: NotificationCategory = explicitCategory ?? "system";

  if (!explicitAudience || !explicitCategory) {
    if (eventType === "community.comment.notification" || eventType === "community.reply.notification") {
      audience = isLandlordCommunityNotification(payload, options, listingId) ? "both" : explicitAudience ?? "user";
      category = "community";
    } else if (isMessageEvent(eventType, payload)) {
      audience = explicitAudience ?? "user";
      category = "message";
    } else if (isWatchlistEvent(eventType, payload)) {
      audience = explicitAudience ?? "user";
      category = "watchlist";
    } else if (BOOKING_LIKE_EVENTS.has(eventType) || eventType.startsWith("booking.")) {
      const legacy = bookingCategoryFromLegacyShape(eventType, payload, bookingStatus, options, listingId);
      if (legacy) {
        audience = explicitAudience ?? legacy.audience;
        category = explicitCategory ?? legacy.category;
      }
    }
  }

  return {
    audience,
    category,
    eventType,
    bookingId: shape.bookingId,
    listingId,
    renterId: shape.renterId,
    tenantId,
    landlordId,
    bookingStatus,
    deepLink: shape.deepLink,
    payload,
  };
}

export function notificationBelongsToSurface(
  item: NotificationItem,
  surface: NotificationSurface,
  options: NotificationClassificationOptions = {},
): boolean {
  const classification = classifyNotification(item, options);
  return classification.audience === "both" || classification.audience === surface;
}

export function notificationHrefForSurface(item: NotificationItem, surface: NotificationSurface): string | null {
  const classification = classifyNotification(item);
  const deep =
    classification.deepLink ||
    String(classification.payload.deep_link ?? classification.payload.deepLink ?? "").trim() ||
    (classification.bookingId ? `/dashboard/bookings/${encodeURIComponent(classification.bookingId)}` : "");
  if (!deep) return null;
  return appendQueryParams(deep, [
    ["nid", UUID_RE.test(item.id) ? item.id.toLowerCase() : String(classification.payload.notification_id ?? "").trim().toLowerCase()],
    ["role", surface === "landlord" ? "landlord" : ""],
    ["from", surface === "landlord" ? "landlord" : "notifications"],
  ]);
}

export function notificationTitleForSurface(
  item: NotificationItem,
  surface: NotificationSurface,
  options: NotificationClassificationOptions = {},
): string {
  const classification = classifyNotification(item, options);
  if (classification.category === "booking_landlord") {
    if (classification.bookingStatus === "CONFIRMED" || classification.bookingStatus === "COMPLETED") {
      return "Confirmed booking on your listing";
    }
    if (classification.bookingStatus === "ACCEPTED") {
      return "Booking accepted — waiting for renter";
    }
    return "New booking request";
  }
  if (classification.category === "booking_renter") {
    switch (classification.eventType) {
      case "booking.accepted":
        return "Your booking request was approved";
      case "booking.confirmed":
        return "Booking confirmed";
      case "booking.rejected":
        return "Booking request rejected";
      case "booking.cancelled":
        return "Booking cancelled";
      case "booking.expired":
        return "Booking expired";
      case "booking.withdrawn":
        return "Booking withdrawn";
      case "booking.status.updated":
        return classification.bookingStatus ? `Booking ${classification.bookingStatus.toLowerCase()}` : "Booking updated";
      default:
        return surface === "landlord" ? "Booking update" : "Booking notification";
    }
  }
  if (classification.eventType === "community.comment.notification") return "New comment on your post";
  if (classification.eventType === "community.reply.notification") return "New reply";
  if (classification.category === "message") return "New message";
  if (classification.category === "watchlist") return "Watchlist update";
  return classification.eventType || "Notification";
}

/** Human-readable landlord notification event (not raw Kafka topic names). */
export function formatLandlordBookingEventLabel(
  eventType: string | null | undefined,
  bookingStatus?: string | null,
): string {
  const et = String(eventType || "").trim().toLowerCase();
  const byEvent: Record<string, string> = {
    "booking.created": "New booking request",
    "booking.requested": "New booking request",
    "booking.request": "New booking request",
    "booking.accepted": "Booking accepted",
    "booking.confirmed": "Booking confirmed",
    "booking.cancelled": "Booking cancelled",
    "booking.canceled": "Booking cancelled",
    "booking.rejected": "Booking rejected",
    "booking.withdrawn": "Booking withdrawn",
    "booking.expired": "Booking expired",
    "booking.status.updated": "Booking updated",
  };
  if (byEvent[et]) return byEvent[et];

  const st = String(bookingStatus || "").trim().toUpperCase();
  if (st === "CONFIRMED" || st === "COMPLETED") return "Booking confirmed";
  if (st === "ACCEPTED" || st === "PENDING_CONFIRMATION") return "Booking accepted";
  if (st === "REJECTED") return "Booking rejected";
  if (st === "CANCELLED" || st === "CANCELED") return "Booking cancelled";
  if (st === "EXPIRED") return "Booking expired";
  if (st === "CREATED" || st === "PENDING") return "New booking request";

  if (et.startsWith("booking.")) {
    const tail = et.slice("booking.".length).replace(/[._]+/g, " ").trim();
    if (!tail) return "Booking update";
    return tail.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  const raw = String(eventType || "").trim();
  return raw || "—";
}

function canonicalBookingStatus(raw: string | undefined): string {
  const upper = String(raw || "").trim().toUpperCase();
  if (upper === "CREATED") return "PENDING";
  if (upper === "APPROVED") return "ACCEPTED";
  if (upper === "DECLINED") return "REJECTED";
  return upper || "—";
}

function bookingReadEventMatchesRole(
  role: "tenant" | "landlord" | "other",
  item: NotificationItem,
  payload: Record<string, unknown>,
): boolean {
  const eventType = effectiveNotificationEventType(item);
  if (role === "landlord") {
    return (
      eventType === "booking.created" ||
      eventType === "booking.request" ||
      eventType === "BookingRequestV1" ||
      eventType === "BookingCreatedV1"
    );
  }
  if (role === "tenant") {
    return (
      eventType === "booking.accepted" ||
      (eventType === "booking.status.updated" &&
        canonicalBookingStatus(String(payload.new_status ?? payload.newStatus ?? "")) === "ACCEPTED")
    );
  }
  return false;
}

export function notificationIdFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get("nid");
  const id = String(raw || "").trim();
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

export function buildBookingDetailNotificationReadPlan(input: {
  role: "tenant" | "landlord" | "other";
  bookingId: string;
  search: string;
  notifications: NotificationItem[];
}): {
  explicitNotificationId: string | null;
  bulkIds: string[];
} {
  const bookingId = String(input.bookingId || "").trim().toLowerCase();
  const explicitNotificationId = notificationIdFromSearch(input.search);
  const ids = new Set<string>();
  for (const item of input.notifications) {
    if (item.read_at) continue;
    const payload = parseNotificationPayloadDeep(item);
    const shape = extractBookingNotificationShape(item, payload);
    if (shape.bookingId !== bookingId) continue;
    if (!bookingReadEventMatchesRole(input.role, item, payload)) continue;
    if (UUID_RE.test(item.id)) ids.add(item.id.toLowerCase());
  }
  return { explicitNotificationId, bulkIds: Array.from(ids) };
}

export function shouldIncludeLandlordBookingFallbackRow(item: NotificationItem): boolean {
  const payload = parseNotificationPayloadDeep(item);
  const source = String(payload.source || "").trim().toLowerCase();
  const isSyntheticFallback =
    source === "webapp.dashboard.booking_fallback" || String(item.id || "").trim().startsWith("local-booking-");
  if (!isSyntheticFallback) return true;
  const notificationId = String(payload.notification_id ?? payload.nid ?? "").trim().toLowerCase();
  return UUID_RE.test(notificationId);
}

/**
 * Landlord dashboard: booking-related rows for recent cards AND table (single source of truth).
 * Accepts multiple payload shapes; does not require deep_link if booking_id + listing_id present.
 */
export function isLandlordBookingNotificationRow(item: NotificationItem): boolean {
  if (!shouldIncludeLandlordBookingFallbackRow(item)) return false;
  const classified = classifyNotification(item);
  if (classified.category === "booking_renter" && classified.audience === "user") return false;
  if (classified.category === "booking_landlord" && classified.audience === "landlord" && UUID_RE.test(classified.bookingId)) {
    return true;
  }
  const et = effectiveNotificationEventType(item);
  const etLower = et.toLowerCase();
  /** Tenant-only inbox event; never landlord booking-request table rows. */
  if (et === "booking.accepted" || etLower === "booking.accepted") return false;

  const p = parseNotificationPayloadDeep(item);
  const { bookingId, listingId, renterId, deepLink } = extractBookingNotificationShape(item, p);
  const src = String(p.source || "").toLowerCase();

  if (BOOKING_LIKE_EVENTS.has(et)) {
    if (UUID_RE.test(bookingId)) {
      if (deepLink.includes("/dashboard/bookings/") || UUID_RE.test(listingId) || UUID_RE.test(renterId)) return true;
      if (et === "booking.created" || et === "booking.request" || et === "BookingRequestV1" || et === "BookingCreatedV1")
        return true;
    }
    if (et === "booking.status.updated") {
      const ns = String(p.new_status ?? p.newStatus ?? p.booking_status ?? "").trim().toUpperCase();
      if ((ns === "PENDING" || ns === "CREATED" || ns === "") && UUID_RE.test(bookingId)) return true;
    }
  }

  /** Payload-first: booking id + listing/renter/deep link, with booking-ish type or Kafka source. */
  if (UUID_RE.test(bookingId)) {
    const shapeOk =
      UUID_RE.test(listingId) || UUID_RE.test(renterId) || deepLink.includes("/dashboard/bookings/");
    if (!shapeOk) {
      /* still allow bare booking id when envelope clearly references booking request flow */
      if (
        etLower.includes("bookingrequest") ||
        etLower.includes("booking_request") ||
        src.includes("booking.request") ||
        src.includes("booking.created") ||
        src.includes("kafka.booking") ||
        src.includes("http.booking")
      ) {
        return true;
      }
      return false;
    }
    if (
      etLower.includes("booking") &&
      !etLower.includes("accepted") &&
      !etLower.includes("message") &&
      !etLower.includes("community")
    ) {
      return true;
    }
    if (src.includes("booking") && !src.includes("accepted")) return true;
  }

  const shape = extractBookingNotificationShape(item, p);
  if (UUID_RE.test(shape.bookingId) && (UUID_RE.test(shape.listingId) || shape.deepLink.includes("/dashboard/bookings/")))
    return true;
  return false;
}

export function renterLabelFromNotificationPayload(p: Record<string, unknown>): string {
  return renterLabelFromBookingPayload(p);
}

export function normalizeLandlordBookingNotification(
  item: NotificationItem,
  listingIdToTitle?: Map<string, string>,
  currentBookingStatusById?: Map<string, string>,
): {
  bookingId: string;
  listingId: string;
  listingLabel: string;
  renterLabel: string;
  bookingStatus: string;
  href: string;
  cardTitle: string;
  actionLabel: string;
  createdAtLabel: string;
  payload: Record<string, unknown>;
} {
  const payload = parseNotificationPayloadDeep(item);
  const shape = extractBookingNotificationShape(item, payload);
  const bookingId = shape.bookingId;
  const listingId = shape.listingId;
  const listingLabel =
    String(payload.listing_title ?? payload.listingTitle ?? "").trim() ||
    (listingId ? listingIdToTitle?.get(listingId) : undefined) ||
    (listingId ? `Listing ${listingId.slice(0, 8)}…` : "—");
  const renterLabel = renterLabelFromNotificationPayload(payload);
  const bookingStatus = canonicalBookingStatus(
    currentBookingStatusById?.get(bookingId) ??
      String(payload.booking_status ?? payload.new_status ?? payload.newStatus ?? item.status ?? "—"),
  );
  const deep =
    shape.deepLink ||
    String(payload.deep_link ?? payload.deepLink ?? "").trim() ||
    (bookingId ? `/dashboard/bookings/${encodeURIComponent(bookingId)}` : "");
  const notificationId = UUID_RE.test(String(payload.notification_id ?? payload.nid ?? "").trim())
    ? String(payload.notification_id ?? payload.nid ?? "").trim().toLowerCase()
    : UUID_RE.test(item.id)
      ? item.id.toLowerCase()
      : "";
  const href = deep
    ? appendQueryParams(deep, [
        ["nid", notificationId],
        ["role", "landlord"],
        ["from", "landlord"],
      ])
    : "";
  const actionLabel = bookingStatus === "PENDING" ? "Respond" : "Open";
  const cardTitle =
    bookingStatus === "CONFIRMED" || bookingStatus === "COMPLETED"
      ? "Confirmed booking on your listing"
      : bookingStatus === "ACCEPTED"
        ? "Booking accepted — waiting for renter"
        : "New booking request";
  return {
    bookingId,
    listingId,
    listingLabel,
    renterLabel,
    bookingStatus,
    href,
    cardTitle,
    actionLabel,
    createdAtLabel: new Date(item.created_at).toLocaleString(),
    payload,
  };
}
