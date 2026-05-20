import { handleHintFromEmail } from "@/lib/user-display";

const INTEGRATION_NOISE =
  /\b(seed(ed|ing)?|integration|fixture|RICH-LISTING-MARKER|FV\s+listing|batch)\b/i;

/** Integration / Cursor test bookings that should not appear on renter dashboards. */
export function isIntegrationBookingNoise(title: string | null | undefined): boolean {
  const s = String(title ?? "").trim();
  if (!s) return false;
  if (/^cursor\s+proof\b/i.test(s) || /^payload\s+check\b/i.test(s) || /^clean\s+check\b/i.test(s)) {
    return true;
  }
  return INTEGRATION_NOISE.test(s);
}
const UUID_HEAD = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-/i;
const EMAILISH = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

/** Listed-by line: never raw UUID/email as primary label in marketplace UI. */
export function formatPublicHostLabel(raw: string | null | undefined): string {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  if (UUID_HEAD.test(s)) return "";
  if (EMAILISH.test(s)) {
    const h = handleHintFromEmail(s);
    return h ? h.slice(0, 80) : "";
  }
  if (INTEGRATION_NOISE.test(s)) return "";
  return s.slice(0, 120);
}
const TRAILING_STAMP = /\b\d{10,}\b\s*$/;

/** Human-friendly listing title for cards and booking rows (hides noisy seeded fixtures). */
export function prettyListingTitle(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s) return "Listing";
  if (/\bseeded\b/i.test(s) && /\d{10,}/.test(s)) {
    const beds = s.match(/^(\d+)\s*bed/i)?.[1];
    return beds ? `${beds}-bed near campus` : "Campus listing";
  }
  if (/^och-page-\d+-/i.test(s)) return "Listing";
  if (/^batch-/i.test(s)) return "Campus listing";
  if (INTEGRATION_NOISE.test(s)) {
    const beds = s.match(/^(\d+)\s*bed/i)?.[1];
    if (beds) return `${beds}-bed near campus`;
    if (/premium\s+furnished/i.test(s)) return "Furnished rental near campus";
    return "Campus listing";
  }
  const out = s.replace(TRAILING_STAMP, "").trim();
  if (INTEGRATION_NOISE.test(out)) {
    const beds = out.match(/^(\d+)\s*bed/i)?.[1];
    return beds ? `${beds}-bed near campus` : "Campus listing";
  }
  return out || "Listing";
}

/** Community / forum bodies: keep full text unless it is clearly fixture noise. */
export function scrubCommunityBody(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (INTEGRATION_NOISE.test(s) || /^section\s*\d+\s*:/i.test(s)) {
    return "This post was generated for integration tests; content is hidden in the public UI.";
  }
  return s;
}

/** Strip seeded/integration copy from card body and previews (primary UI). */
export function prettyListingDescription(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s) return "Campus-adjacent housing listing.";
  if (INTEGRATION_NOISE.test(s) || /^section\s*\d+\s*:/i.test(s)) {
    return "Details available on the full listing page.";
  }
  if (s.length > 280) return `${s.slice(0, 277)}…`;
  return s;
}

const UUID_LINE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Titles for booking rows / dashboards (reuse listing rules + strip UUID-only). */
export function prettyBookingTitle(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s || UUID_LINE.test(s)) return prettyListingTitle(null);
  return prettyListingTitle(s);
}

/** One-line preview for inbox / thread list (booking system lines, UUIDs). */
export function prettyMessagePreview(raw: string | null | undefined): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^booking request created for listing/i.test(s)) return "Booking update";
  if (UUID_LINE.test(s)) return "New activity";
  if (INTEGRATION_NOISE.test(s) || /\bseeded\b/i.test(s)) return "Listing update";
  if (s.length > 160) return `${s.slice(0, 157)}…`;
  return s;
}

/** Map domain booking status to short UI label. */
export function prettyBookingStatus(status: string | null | undefined): string {
  const s = String(status || "").trim().toUpperCase();
  switch (s) {
    case "PENDING":
      return "Pending";
    case "ACCEPTED":
    case "APPROVED":
      return "Approved";
    case "CONFIRMED":
      return "Confirmed";
    case "REJECTED":
      return "Rejected";
    case "CANCELLED":
      return "Cancelled";
    case "EXPIRED":
      return "Expired";
    case "COMPLETED":
      return "Completed";
    default:
      return s ? s.charAt(0) + s.slice(1).toLowerCase() : "Unknown";
  }
}
