/**
 * Server-side peer review eligibility: booking must exist, caller must be a party,
 * and booking must be APPROVED (landlord accepted), CONFIRMED, or COMPLETED — not cancelled/rejected/expired.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type BookingPartySnapshot = {
  status: string;
  tenant_id: string;
  landlord_id: string;
  /** YYYY-MM-DD lease end (UTC calendar), from booking-service public JSON. */
  end_date?: string | null;
};

function statusUpper(s: string): string {
  return String(s || "").trim().toUpperCase();
}

/** Ineligible terminal / withdrawn-style states (product: no peer review on these). */
function peerReviewIneligibleStatus(st: string): boolean {
  const u = statusUpper(st);
  return (
    u === "CANCELLED" ||
    u === "REJECTED" ||
    u === "EXPIRED" ||
    u === "WITHDRAWN" ||
    u === "DECLINED" ||
    u === "PENDING" ||
    u === "CREATED"
  );
}

export function bookingEligibleForPeerReviewSnap(snap: BookingPartySnapshot): boolean {
  const st = statusUpper(snap.status);
  if (!st || peerReviewIneligibleStatus(st)) return false;
  if (st === "COMPLETED") return true;
  if (st === "CONFIRMED") return true;
  /** Domain APPROVED / ACCEPTED; DB may expose `pending_confirmation`. */
  if (st === "ACCEPTED" || st === "APPROVED" || st === "PENDING_CONFIRMATION") return true;
  return false;
}

export async function loadBookingForPeerReviewGate(
  bookingId: string,
  reviewerUserId: string,
): Promise<BookingPartySnapshot | null> {
  const base = (process.env.BOOKING_HTTP || "").replace(/\/$/, "").trim();
  if (!base) {
    return null;
  }
  if (!UUID_RE.test(bookingId) || !UUID_RE.test(reviewerUserId)) return null;
  const url = `${base}/${encodeURIComponent(bookingId)}`;
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-user-id": reviewerUserId, Accept: "application/json" },
      signal: ac.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = (await res.json()) as Record<string, unknown>;
    const status = String(j.status ?? j.booking_status ?? "").trim();
    const tenant_id = String(j.tenant_id ?? j.tenantId ?? "").trim();
    const landlord_id = String(j.landlord_id ?? j.landlordId ?? "").trim();
    const endRaw = j.endDate ?? j.end_date;
    const end_date =
      typeof endRaw === "string" && /^\d{4}-\d{2}-\d{2}/.test(endRaw) ? String(endRaw).slice(0, 10) : null;
    if (!status || !UUID_RE.test(tenant_id) || !UUID_RE.test(landlord_id)) return null;
    return { status, tenant_id, landlord_id, end_date };
  } catch (e) {
    console.warn("[peer-review] booking lookup failed", e instanceof Error ? e.message : e);
    return null;
  }
}

export function assertBookingEligibleForPeerReview(
  snap: BookingPartySnapshot,
  reviewerId: string,
  revieweeId: string,
): { ok: true } | { ok: false; status: number; message: string } {
  if (!bookingEligibleForPeerReviewSnap(snap)) {
    return {
      ok: false,
      status: 400,
      message:
        "peer reviews require an approved or active booking: status must be APPROVED/ACCEPTED (landlord accepted), CONFIRMED, or COMPLETED — not cancelled, rejected, expired, or withdrawn",
    };
  }
  const rid = reviewerId.trim().toLowerCase();
  const tid = snap.tenant_id.trim().toLowerCase();
  const lid = snap.landlord_id.trim().toLowerCase();
  const rev = revieweeId.trim().toLowerCase();
  if (rid !== tid && rid !== lid) {
    return { ok: false, status: 403, message: "not a party on this booking" };
  }
  if (rev !== tid && rev !== lid) {
    return { ok: false, status: 400, message: "reviewee must be the other party on the booking" };
  }
  if (rev === rid) {
    return { ok: false, status: 400, message: "cannot review yourself" };
  }
  return { ok: true };
}
