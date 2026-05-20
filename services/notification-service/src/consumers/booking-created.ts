import type { Pool } from "pg";
import { buildNotificationDedupeKey } from "../booking-notification-model.js";
import { upsertNotificationByDedupeKey } from "../notification-upsert.js";

export type BookingCreatedPayload = {
  bookingId?: string;
  listingId?: string;
  tenantId?: string;
  renterId?: string;
  landlordId?: string;
  createdAt?: string;
  listingTitle?: string | null;
  tenantUsername?: string | null;
  tenantUsernameSnapshot?: string | null;
  tenantDisplayName?: string | null;
  tenantEmail?: string | null;
  bookingStatus?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  deepLink?: string | null;
  notificationSource?: string;
};

function isUuid(input: string | undefined): input is string {
  return Boolean(input && /^[0-9a-f-]{36}$/i.test(input));
}

function parsePayloadObject(raw: Record<string, unknown>): Record<string, unknown> {
  const p = raw.payload;
  if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
  if (typeof p === "string") {
    try {
      const j = JSON.parse(p) as unknown;
      if (j && typeof j === "object" && !Array.isArray(j)) return j as Record<string, unknown>;
    } catch {
      /* ignore */
    }
  }
  return (raw.payload as Record<string, unknown>) || raw;
}

export function parseBookingCreated(value: Buffer): BookingCreatedPayload | null {
  try {
    const raw = JSON.parse(value.toString("utf8")) as Record<string, unknown>;
    const md = (raw.metadata as Record<string, unknown>) || {};
    /** Booking-service publishes `metadata.event_type`; legacy events may set top-level `event`. */
    const event = String(
      raw.event ||
        raw.type ||
        raw.event_type ||
        md.event_type ||
        md.EventType ||
        md.type ||
        md.Type ||
        "",
    ).trim();
    if (event !== "booking.created" && event !== "BookingCreatedV1" && event !== "BookingRequestV1") {
      return null;
    }
    const payload = parsePayloadObject(raw);
    return {
      bookingId: String(payload.bookingId || payload.booking_id || payload.id || md.aggregate_id || ""),
      listingId: String(payload.listingId || payload.listing_id || ""),
      tenantId: String(payload.tenantId || payload.tenant_id || payload.renterId || payload.renter_id || ""),
      renterId: String(payload.renterId || payload.renter_id || payload.tenantId || payload.tenant_id || ""),
      landlordId: String(payload.landlordId || payload.landlord_id || payload.recipient_id || ""),
      createdAt: String(payload.createdAt || payload.created_at || ""),
      listingTitle:
        payload.listingTitle != null || payload.listing_title != null
          ? String(payload.listingTitle ?? payload.listing_title ?? "")
          : null,
      tenantUsername:
        payload.tenantUsername != null || payload.tenant_username != null
          ? String(payload.tenantUsername ?? payload.tenant_username ?? "")
          : null,
      tenantUsernameSnapshot:
        payload.tenantUsernameSnapshot != null || payload.tenant_username_snapshot != null
          ? String(payload.tenantUsernameSnapshot ?? payload.tenant_username_snapshot ?? "")
          : null,
      tenantDisplayName:
        payload.tenantDisplayName != null || payload.tenant_display_name != null
          ? String(payload.tenantDisplayName ?? payload.tenant_display_name ?? "")
          : null,
      tenantEmail:
        payload.tenantEmail != null || payload.tenant_email != null
          ? String(payload.tenantEmail ?? payload.tenant_email ?? "")
          : null,
      bookingStatus:
        payload.bookingStatus != null || payload.booking_status != null
          ? String(payload.bookingStatus ?? payload.booking_status ?? "")
          : null,
      startDate:
        payload.startDate != null || payload.start_date != null
          ? String(payload.startDate ?? payload.start_date ?? "")
          : null,
      endDate:
        payload.endDate != null || payload.end_date != null
          ? String(payload.endDate ?? payload.end_date ?? "")
          : null,
      deepLink:
        payload.deepLink != null || payload.deep_link != null
          ? String(payload.deepLink ?? payload.deep_link ?? "")
          : null,
    };
  } catch {
    return null;
  }
}

export function normalizeLandlordBookingNotificationPayload(
  payload: BookingCreatedPayload,
): Record<string, unknown> {
  const rawLandlord = String(payload.landlordId || "").trim();
  const landlordId = /^[0-9a-f-]{36}$/i.test(rawLandlord) ? rawLandlord.toLowerCase() : rawLandlord;
  const bookingId = String(payload.bookingId || "").trim();
  const listingId = String(payload.listingId || "").trim();
  const tenantId = String(payload.tenantId || "").trim();
  const tenantUsername = String(payload.tenantUsername ?? "").trim().replace(/^@+/, "") || null;
  const tenantUsernameSnapshot =
    String(payload.tenantUsernameSnapshot ?? "").trim().replace(/^@+/, "") || tenantUsername;
  const tenantDisplayName = String(payload.tenantDisplayName ?? "").trim() || null;
  const tenantEmail = String(payload.tenantEmail ?? "").trim() || null;
  const bookingStatus = String(payload.bookingStatus ?? "PENDING").trim().toUpperCase() || "PENDING";
  const deepLink =
    String(payload.deepLink ?? "").trim() ||
    (bookingId && isUuid(bookingId) ? `/dashboard/bookings/${encodeURIComponent(bookingId)}` : null);

  return {
    notification_audience: "landlord",
    notification_category: "booking_landlord",
    notification_recipient_role: "landlord",
    category: "booking",
    context_type: "booking",
    context_id: bookingId || null,
    bookingId: bookingId || null,
    booking_id: bookingId || null,
    listingId: listingId || null,
    listing_id: listingId || null,
    listingTitle: payload.listingTitle ?? null,
    listing_title: payload.listingTitle ?? null,
    tenantId: tenantId || null,
    tenant_id: tenantId || null,
    renterId: tenantId || null,
    renter_id: tenantId || null,
    landlordId: landlordId || null,
    landlord_id: landlordId || null,
    tenant_username: tenantUsername,
    tenant_username_snapshot: tenantUsernameSnapshot,
    tenant_display_name: tenantDisplayName,
    tenant_email: tenantEmail,
    tenantEmail: tenantEmail,
    renter_username: tenantUsernameSnapshot || tenantUsername || null,
    createdAt: payload.createdAt || null,
    created_at: payload.createdAt || null,
    booking_status: bookingStatus,
    start_date: payload.startDate ?? null,
    end_date: payload.endDate ?? null,
    deep_link: deepLink,
    source: payload.notificationSource ?? "kafka.booking.created",
  };
}

/**
 * Idempotent insert for landlord booking-request notifications.
 * Returns true when a new row was inserted (caller may publish realtime).
 */
export async function createLandlordBookingNotification(pool: Pool, payload: BookingCreatedPayload): Promise<boolean> {
  const rawLandlord = String(payload.landlordId || "").trim();
  const landlordId = /^[0-9a-f-]{36}$/i.test(rawLandlord) ? rawLandlord.toLowerCase() : rawLandlord;
  if (!isUuid(landlordId)) return false;
  const bid = String(payload.bookingId || "").trim();
  if (!isUuid(bid)) return false;
  const payloadObj = normalizeLandlordBookingNotificationPayload({
    ...payload,
    landlordId,
  });
  const dedupeKey = buildNotificationDedupeKey({
    recipientUserId: landlordId,
    eventType: "booking.created",
    contextType: "booking",
    contextId: bid,
    statusSegment: String(payloadObj.booking_status ?? "PENDING").trim().toUpperCase() || "PENDING",
  });
  const r = await upsertNotificationByDedupeKey(pool, {
    userId: landlordId,
    eventType: "booking.created",
    payload: payloadObj,
    dedupeKey,
  });
  return r.inserted;
}
