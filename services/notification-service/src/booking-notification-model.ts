/** Domain status strings as emitted on booking.status.updated (booking-service). */
export type BookingDomainStatusUpper =
  | "PENDING"
  | "ACCEPTED"
  | "CONFIRMED"
  | "REJECTED"
  | "CANCELLED"
  | "EXPIRED"
  | "WITHDRAWN"
  | "COMPLETED";

export function bookingNotificationEventForStatus(
  status: string,
  audience: "tenant" | "landlord",
): string {
  const normalized = String(status || "").trim().toLowerCase();
  if (["accepted", "pending_confirmation", "confirmed"].includes(normalized)) {
    return audience === "tenant" ? "booking.accepted" : "booking.confirmed";
  }
  if (["cancelled", "canceled", "withdrawn"].includes(normalized)) {
    return "booking.cancelled";
  }
  if (["rejected", "declined"].includes(normalized)) {
    return "booking.rejected";
  }
  if (normalized === "expired") return "booking.expired";
  if (normalized === "pending" || normalized === "created") return "booking.created";
  return "booking.updated";
}

/** Single UPSERT bucket for renter post-approval (ACCEPTED / pending_confirmation / CONFIRMED). */
export const TENANT_BOOKING_APPROVAL_DEDUPE_STATUS = "APPROVAL";

/** Landlord confirmation / post-accept workflow bucket. */
export const LANDLORD_BOOKING_CONFIRM_DEDUPE_STATUS = "CONFIRMATION";

export function buildNotificationDedupeKey(parts: {
  recipientUserId: string;
  eventType: string;
  contextType: string;
  contextId: string;
  statusSegment: string;
}): string {
  const uid = String(parts.recipientUserId || "").trim().toLowerCase();
  const et = String(parts.eventType || "").trim();
  const ct = String(parts.contextType || "").trim();
  const cid = String(parts.contextId || "").trim().toLowerCase();
  const st = String(parts.statusSegment || "").trim();
  return `${uid}:${et}:${ct}:${cid}:${st}`;
}
