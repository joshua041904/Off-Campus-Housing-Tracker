import { buildOutgoingHttpHeadersFromContext } from "@common/utils/otel";

/**
 * Synchronous in-app notification for tenants when a landlord approves a booking.
 * Complements Kafka: ensures a row exists even if the notification consumer is down or lagging.
 */
const UUID_HEX36 = /^[0-9a-f-]{36}$/i;
type PropagationContext = Parameters<typeof buildOutgoingHttpHeadersFromContext>[0];

export async function notifyTenantBookingAcceptedHttp(input: {
  tenantId: string;
  bookingId: string;
  listingId: string;
  landlordId: string;
  previousStatus: string;
  listingTitle?: string | null;
  tenantUsernameSnapshot?: string | null;
  tenantEmailSnapshot?: string | null;
}, propagationContext?: PropagationContext): Promise<void> {
  const base = (process.env.NOTIFICATION_HTTP || "").replace(/\/$/, "");
  const secret = (process.env.BOOKING_LISTINGS_INTERNAL_SECRET || "").trim();
  if (!base || !secret) {
    console.warn("[booking] tenant accept notify skipped — NOTIFICATION_HTTP or BOOKING_LISTINGS_INTERNAL_SECRET unset");
    return;
  }
  const tenantNorm = UUID_HEX36.test(input.tenantId.trim())
    ? input.tenantId.trim().toLowerCase()
    : input.tenantId.trim();
  const traceHeaders = propagationContext ? buildOutgoingHttpHeadersFromContext(propagationContext) : {};
  try {
    const r = await fetch(`${base}/internal/push-notification`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-booking-internal-secret": secret,
        ...traceHeaders,
      },
      body: JSON.stringify({
        user_id: tenantNorm,
        event_type: "booking.accepted",
        payload: {
          bookingId: input.bookingId,
          listingId: input.listingId,
          landlordId: input.landlordId,
          tenantId: input.tenantId,
          previousStatus: input.previousStatus,
          listingTitle: input.listingTitle ?? null,
          tenantUsernameSnapshot: input.tenantUsernameSnapshot ?? null,
          tenant_username_snapshot: input.tenantUsernameSnapshot ?? null,
          tenantEmail: input.tenantEmailSnapshot ?? null,
          tenant_email: input.tenantEmailSnapshot ?? null,
          source: "http.booking.accepted",
        },
      }),
      signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => "");
      console.warn("[booking] tenant booking-accepted notify HTTP failed", r.status, t.slice(0, 500));
    }
  } catch (e) {
    console.warn("[booking] tenant booking-accepted notify error", e instanceof Error ? e.message : e);
  }
}
