import { buildOutgoingHttpHeadersFromContext } from "@common/utils/otel";

type PropagationContext = Parameters<typeof buildOutgoingHttpHeadersFromContext>[0];

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BookingRequestListingMeta = {
  landlordId: string;
  priceCents: number;
  title: string | null;
  listing_on_hold: boolean;
  pricing_mode: "fixed" | "obo";
};

export function listingMetaFromJson(j: Record<string, unknown>): BookingRequestListingMeta | null {
  const rawLandlord = String(j.landlord_id ?? j.user_id ?? "").trim();
  const landlordId = UUID_RE.test(rawLandlord) ? rawLandlord.toLowerCase() : rawLandlord;
  if (!UUID_RE.test(landlordId)) return null;
  let priceCents = Number(j.price_cents);
  if (!Number.isFinite(priceCents) && typeof j.price === "number") {
    priceCents = Math.round(j.price * 100);
  }
  if (!Number.isFinite(priceCents)) {
    const pUsd = j.price_usd_monthly ?? j.price;
    if (typeof pUsd === "number" && Number.isFinite(pUsd)) {
      priceCents = Math.round(pUsd * 100);
    }
  }
  if (!Number.isFinite(priceCents)) priceCents = 0;
  const titleRaw = j.title != null ? String(j.title).trim() : "";
  const title = titleRaw ? titleRaw.slice(0, 512) : null;
  const pmRaw = String(j.pricing_mode ?? "fixed").trim().toLowerCase();
  const pricing_mode = pmRaw === "obo" ? "obo" : "fixed";
  const holdRaw = j.soft_hold_until ?? j.listing_on_hold;
  let listing_on_hold = false;
  if (typeof j.listing_on_hold === "boolean") listing_on_hold = j.listing_on_hold;
  else if (holdRaw instanceof Date) listing_on_hold = holdRaw.getTime() > Date.now();
  else if (holdRaw != null && String(holdRaw).trim()) {
    const t = Date.parse(String(holdRaw));
    listing_on_hold = Number.isFinite(t) && t > Date.now();
  }
  return { landlordId, priceCents, title, listing_on_hold, pricing_mode };
}

export async function fetchListingMetaForBookingRequest(
  listingId: string,
  propagationContext?: PropagationContext,
): Promise<BookingRequestListingMeta | null> {
  const base = (process.env.LISTINGS_HTTP || "http://127.0.0.1:4012").replace(/\/$/, "");
  const secret = (process.env.BOOKING_LISTINGS_INTERNAL_SECRET || "").trim();
  const ms = Number(process.env.BOOKING_LISTING_FETCH_TIMEOUT_MS ?? "12000");
  const timeout = Number.isFinite(ms) ? Math.min(120_000, Math.max(1000, ms)) : 12_000;
  const tracedHeaders = propagationContext ? buildOutgoingHttpHeadersFromContext(propagationContext) : {};

  if (secret) {
    try {
      const internalUrl = `${base}/internal/listings/${encodeURIComponent(listingId)}`;
      const upstream = await fetch(internalUrl, {
        headers: {
          "x-booking-internal-secret": secret,
          ...tracedHeaders,
        },
        signal: AbortSignal.timeout(timeout),
      });
      if (upstream.ok) {
        const j = (await upstream.json()) as Record<string, unknown>;
        const meta = listingMetaFromJson(j);
        if (meta) return meta;
      } else if (upstream.status === 404) {
        return null;
      }
    } catch {
      /* fall through to public listing */
    }
  }

  const url = `${base}/listings/${listingId}`;
  let upstream: globalThis.Response;
  try {
    upstream = await fetch(url, {
      headers: tracedHeaders,
      signal: AbortSignal.timeout(timeout),
    });
  } catch {
    throw new Error("listings_fetch_failed");
  }
  if (upstream.status === 404) return null;
  if (!upstream.ok) throw new Error(`listings_http_${upstream.status}`);
  const j = (await upstream.json()) as Record<string, unknown>;
  return listingMetaFromJson(j);
}
