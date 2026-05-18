import type { Pool } from "pg";
import {
  TENANT_BOOKING_APPROVAL_DEDUPE_STATUS,
  buildNotificationDedupeKey,
} from "../booking-notification-model.js";
import { upsertNotificationByDedupeKey } from "../notification-upsert.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type TenantBookingAcceptedPayload = {
  tenantId: string;
  bookingId: string;
  listingId: string;
  landlordId: string;
  previousStatus?: string | null;
  newStatus?: string | null;
  listingTitle?: string | null;
  notificationSource?: string;
  tenantUsernameSnapshot?: string | null;
  tenantUsername?: string | null;
  tenantEmail?: string | null;
};

/**
 * Idempotent upsert for renter post-approval (ACCEPTED / pending_confirmation / CONFIRMED domain statuses).
 * Kafka + HTTP safety-net share the same dedupe_key.
 */
export async function createTenantBookingAcceptedNotification(
  pool: Pool,
  input: TenantBookingAcceptedPayload,
): Promise<{ inserted: boolean; notificationId: string | null }> {
  const tenantId = String(input.tenantId || "").trim().toLowerCase();
  const bid = String(input.bookingId || "").trim().toLowerCase();
  if (!UUID_RE.test(tenantId) || !UUID_RE.test(bid)) {
    return { inserted: false, notificationId: null };
  }

  const lid = String(input.landlordId || "").trim().toLowerCase();
  const listingId = String(input.listingId || "").trim().toLowerCase();
  const domainStatus = String(input.newStatus || "ACCEPTED").trim().toUpperCase();
  const deep = `/dashboard/bookings/${encodeURIComponent(bid)}`;
  const tu = String(input.tenantUsername ?? "").trim().replace(/^@+/, "") || null;
  const tus = String(input.tenantUsernameSnapshot ?? "").trim().replace(/^@+/, "") || tu;
  const tem = String(input.tenantEmail ?? "").trim() || null;
  const payloadObj: Record<string, unknown> = {
    notification_audience: "user",
    notification_category: "booking_renter",
    notification_recipient_role: "tenant",
    category: "booking",
    context_type: "booking",
    context_id: bid,
    bookingId: bid,
    booking_id: bid,
    listingId: UUID_RE.test(listingId) ? listingId : null,
    listing_id: UUID_RE.test(listingId) ? listingId : null,
    landlordId: UUID_RE.test(lid) ? lid : null,
    landlord_id: UUID_RE.test(lid) ? lid : null,
    tenantId,
    tenant_id: tenantId,
    renter_username: tus || tu,
    tenant_username: tu,
    tenant_username_snapshot: tus || null,
    tenant_email: tem,
    tenantEmail: tem,
    previousStatus: input.previousStatus ?? "",
    previous_status: input.previousStatus ?? "",
    new_status: domainStatus,
    newStatus: domainStatus,
    booking_status: domainStatus,
    listingTitle: input.listingTitle ?? null,
    listing_title: input.listingTitle ?? null,
    deep_link: deep,
    source: input.notificationSource ?? "notification.booking.accepted",
  };

  const dedupeKey = buildNotificationDedupeKey({
    recipientUserId: tenantId,
    eventType: "booking.accepted",
    contextType: "booking",
    contextId: bid,
    statusSegment: TENANT_BOOKING_APPROVAL_DEDUPE_STATUS,
  });

  const r = await upsertNotificationByDedupeKey(pool, {
    userId: tenantId,
    eventType: "booking.accepted",
    payload: payloadObj,
    dedupeKey,
  });
  return { inserted: r.inserted, notificationId: r.notificationId };
}
