import { buildOutgoingHttpHeadersFromContext } from "@common/utils/otel";

/**
 * Synchronous in-app notification for landlords when a renter submits a booking request.
 * Complements Kafka: ensures a row exists even if the notification consumer is down or lagging.
 */
const UUID_HEX36 = /^[0-9a-f-]{36}$/i;
type PropagationContext = Parameters<typeof buildOutgoingHttpHeadersFromContext>[0];

async function postLandlordNotifyOnce(
  url: string,
  secret: string,
  body: Record<string, unknown>,
  propagationContext?: PropagationContext,
): Promise<{ ok: boolean; status: number; text: string }> {
  const traceHeaders = propagationContext ? buildOutgoingHttpHeadersFromContext(propagationContext) : {};
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-booking-internal-secret": secret,
      ...traceHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
  });
  const t = await r.text().catch(() => "");
  return { ok: r.ok, status: r.status, text: t };
}

export async function notifyLandlordBookingRequestHttp(input: {
  landlordId: string;
  bookingId: string;
  listingId: string;
  tenantId: string;
  createdAt: string;
  listingTitle?: string | null;
  tenantUsername?: string | null;
  tenantUsernameSnapshot?: string | null;
  tenantDisplayName?: string | null;
  tenantEmail?: string | null;
  bookingStatus?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}, propagationContext?: PropagationContext): Promise<void> {
  const base = (process.env.NOTIFICATION_HTTP || "").replace(/\/$/, "");
  const secret = (process.env.BOOKING_LISTINGS_INTERNAL_SECRET || "").trim();
  if (!base || !secret) {
    console.warn("[booking] landlord booking notify skipped — NOTIFICATION_HTTP or BOOKING_LISTINGS_INTERNAL_SECRET unset");
    return;
  }
  const landlordNorm = UUID_HEX36.test(input.landlordId.trim())
    ? input.landlordId.trim().toLowerCase()
    : input.landlordId.trim();
  const url = `${base}/internal/push-notification`;
  const email = String(input.tenantEmail ?? "").trim();
  const body: Record<string, unknown> = {
    user_id: landlordNorm,
    event_type: "booking.created",
    payload: {
      booking_id: input.bookingId,
      bookingId: input.bookingId,
      listing_id: input.listingId,
      listingId: input.listingId,
      listing_title: input.listingTitle ?? null,
      listingTitle: input.listingTitle ?? null,
      tenant_id: input.tenantId,
      tenantId: input.tenantId,
      renter_id: input.tenantId,
      renterId: input.tenantId,
      tenant_username: input.tenantUsername ?? null,
      tenant_username_snapshot: input.tenantUsernameSnapshot ?? input.tenantUsername ?? null,
      tenant_display_name: input.tenantDisplayName ?? null,
      tenant_email: email || null,
      tenantEmail: email || null,
      booking_status: String(input.bookingStatus ?? "PENDING").trim().toUpperCase() || "PENDING",
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
      created_at: input.createdAt,
      createdAt: input.createdAt,
      deep_link: `/dashboard/bookings/${encodeURIComponent(input.bookingId)}`,
      source: "http.booking.request",
    },
  };

  const retryable = (status: number) => status === 502 || status === 503 || status === 504 || status === 429;

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await postLandlordNotifyOnce(url, secret, body, propagationContext);
      if (res.ok) return;
      if (!retryable(res.status) || attempt === 2) {
        console.warn("[booking] landlord booking notify HTTP failed", res.status, res.text.slice(0, 500));
        return;
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    } catch (e) {
      if (attempt === 2) {
        console.warn("[booking] landlord booking notify error", e instanceof Error ? e.message : e);
        return;
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}
