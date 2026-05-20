"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  getReputation,
  listMyBookings,
  listUserTrustReviews,
  reportAbuse,
  resolveTrustPublicUserHandle,
  searchMessagingUsers,
  submitPeerReview,
  type TenantBookingSummary,
  type TrustReviewRow,
} from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { getSubFromJwt, getUsernameFromJwt } from "@/lib/jwt-sub";
import { Nav } from "@/components/Nav";
import { prettyBookingTitle } from "@/lib/listing-display";
import { handleHintFromEmail, formatBookingCounterpartyHint, formatIdentityPriority } from "@/lib/user-display";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function resolveOchUserId(token: string | null, raw: string): Promise<string> {
  const q = raw.trim();
  if (!q) throw new Error("Enter a username or user id.");
  if (UUID_RE.test(q)) return q;
  if (!token) throw new Error("Sign in to resolve a username to an id.");
  const hits = await searchMessagingUsers(token, q);
  const want = q.replace(/^@+/, "").toLowerCase();
  const exact =
    hits.find((h) => h.username?.toLowerCase() === want) ||
    hits.find((h) => (h.display_name || "").trim().toLowerCase() === want);
  const pick = exact || hits[0];
  if (!pick?.id) throw new Error(`No user found for “${raw.trim()}”. Try another spelling.`);
  return pick.id;
}

async function resolveReputationUserId(raw: string): Promise<string> {
  const q = raw.trim();
  if (!q) throw new Error("Enter a username, @handle, or user id.");
  if (UUID_RE.test(q)) return q;
  const matches = await resolveTrustPublicUserHandle(q);
  if (matches.length === 0) {
    throw new Error(`No user found for “${q.trim()}”. Try another spelling or exact @username.`);
  }
  if (matches.length > 1) {
    const labels = matches
      .slice(0, 5)
      .map((m) => m.username || m.display_name || m.id)
      .join(", ");
    throw new Error(
      `Multiple matches (${labels}${matches.length > 5 ? ", …" : ""}). Narrow your search (e.g. exact @username).`,
    );
  }
  return matches[0].id;
}

export default function TrustPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [mySub, setMySub] = useState<string | null>(null);

  const [repQuery, setRepQuery] = useState("");
  const [repScore, setRepScore] = useState<number | null>(null);
  const [repResolvedId, setRepResolvedId] = useState<string | null>(null);
  const [repAvg, setRepAvg] = useState<number | null>(null);
  const [repCount, setRepCount] = useState<number | null>(null);
  const [repReviews, setRepReviews] = useState<TrustReviewRow[]>([]);

  const [abuseType, setAbuseType] = useState<"listing" | "user">("listing");
  const [abuseTarget, setAbuseTarget] = useState("");
  const [abuseCategory, setAbuseCategory] = useState("spam");
  const [abuseDetails, setAbuseDetails] = useState("");

  const [myBookings, setMyBookings] = useState<TenantBookingSummary[]>([]);
  const [bookingId, setBookingId] = useState("");
  const [revieweeQuery, setRevieweeQuery] = useState("");
  const [side, setSide] = useState("");
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState("");

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    const t = getStoredToken();
    setToken(t);
    setEmail(getStoredEmail());
    const sub = getSubFromJwt(t);
    setMySub(sub);
  }, []);

  useEffect(() => {
    if (!token) {
      setMyBookings([]);
      return;
    }
    let cancelled = false;
    listMyBookings(token, { peerReviewEligible: true, includeArchived: true, role: "either" })
      .then((rows) => {
        if (!cancelled) setMyBookings(rows);
      })
      .catch(() => {
        if (!cancelled) setMyBookings([]);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!bookingId || !mySub) return;
    const b = myBookings.find((x) => String(x.booking_id) === String(bookingId));
    if (!b) return;
    const hint = formatBookingCounterpartyHint(b, mySub);
    setRevieweeQuery(hint);
    const tenant = String(b.tenant_id ?? "").trim().toLowerCase();
    const me = String(mySub).trim().toLowerCase();
    setSide(tenant === me ? "landlord" : "tenant");
    let cancelled = false;
    const otherId =
      tenant === me ? String(b.landlord_id ?? "").trim() : String(b.tenant_id ?? "").trim();
    if (!UUID_RE.test(otherId)) return;
    void (async () => {
      try {
        const matches = await resolveTrustPublicUserHandle(otherId);
        if (cancelled) return;
        const un = matches[0]?.username || matches[0]?.display_name;
        if (un) {
          const q = String(un).startsWith("@") ? String(un) : `@${un}`;
          setRevieweeQuery(q);
        }
      } catch {
        /* keep booking-derived hint */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookingId, myBookings, mySub]);

  async function onReputation(e: React.FormEvent) {
    e.preventDefault();
    if (!repQuery.trim()) return;
    setErr(null);
    setLoading(true);
    try {
      const id = UUID_RE.test(repQuery.trim())
        ? repQuery.trim()
        : await resolveReputationUserId(repQuery);
      const r = await getReputation(id);
      setRepScore(r.score);
      setRepResolvedId(id);
      setRepAvg(r.avg_rating ?? null);
      setRepCount(r.review_count ?? 0);
      const rev = await listUserTrustReviews(id, { limit: 30 }).catch(() => ({ items: [] as TrustReviewRow[] }));
      setRepReviews(rev.items);
      const label = UUID_RE.test(repQuery.trim()) ? "user id" : repQuery.trim();
      setMsg(`Reputation for ${label}: ${r.score}`);
    } catch (e: unknown) {
      setRepScore(null);
      setRepResolvedId(null);
      setRepAvg(null);
      setRepCount(null);
      setRepReviews([]);
      setErr(e instanceof Error ? e.message : "Lookup failed");
    } finally {
      setLoading(false);
    }
  }

  async function onReport(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setMsg(null);
    setErr(null);
    setLoading(true);
    try {
      const raw = abuseTarget.trim();
      const target_id =
        abuseType === "listing" ? raw : await resolveOchUserId(token, raw);
      await reportAbuse(token, {
        abuse_target_type: abuseType,
        target_id,
        category: abuseCategory,
        details: abuseDetails,
      });
      setMsg("Report submitted.");
      setAbuseDetails("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Report failed");
    } finally {
      setLoading(false);
    }
  }

  async function onPeerReview(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setMsg(null);
    setErr(null);
    setLoading(true);
    try {
      const bid = bookingId.trim();
      if (!UUID_RE.test(bid)) throw new Error("Choose a booking from the list (only eligible stays appear).");
      const reviewee_id = await resolveOchUserId(token, revieweeQuery);
      await submitPeerReview(token, {
        booking_id: bid,
        reviewee_id,
        side,
        rating,
        comment,
      });
      setMsg("Peer review submitted.");
      setComment("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Review failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-emerald-50/50 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="font-serif text-3xl text-slate-900">Trust &amp; safety</h1>
        <p className="mt-2 text-sm text-slate-600">
          Report abuse and submit peer reviews via gateway → trust-service. Reputation lookup is username-first (public
          directory); messaging search is still used where signed-in resolution is needed.
        </p>

        <section className="mt-10 rounded-xl border border-slate-200 bg-white/80 p-6 shadow-sm">
          <h2 className="text-lg font-medium text-slate-900">Reputation</h2>
          <form data-testid="trust-reputation-form" onSubmit={onReputation} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input
              data-testid="trust-reputation-query"
              value={repQuery}
              onChange={(e) => setRepQuery(e.target.value)}
              placeholder="Username, @handle, or display name"
              className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
            />
            <button
              type="submit"
              disabled={loading}
              data-testid="trust-reputation-submit"
              className="rounded-md bg-teal-600 px-4 py-2 font-medium text-white hover:bg-teal-500 disabled:opacity-50"
            >
              Look up
            </button>
          </form>
          {token && (
            <button
              type="button"
              className="mt-2 text-xs font-medium text-teal-700 hover:underline"
              onClick={() => {
                setErr(null);
                const un = getUsernameFromJwt(token);
                if (un) setRepQuery(un.startsWith("@") ? un : `@${un}`);
                else setErr("Your session has no username claim; type your @handle manually.");
              }}
            >
              Use my @username from session
            </button>
          )}
          {repScore != null && (
            <p data-testid="trust-reputation-score" className="mt-4 text-sm text-slate-600">
              Score: <strong className="text-teal-800">{repScore}</strong>
              {repCount != null && repCount > 0 ? (
                <>
                  {" "}
                  · Avg peer rating:{" "}
                  <strong className="text-teal-800">
                    {repAvg != null ? repAvg.toFixed(1) : "—"}
                  </strong>{" "}
                  / 5 ({repCount} reviews)
                </>
              ) : null}
            </p>
          )}
          {repResolvedId ? (
            <div className="mt-4 rounded-lg border border-slate-100 bg-slate-50/80 p-4">
              <p className="text-xs font-medium text-slate-700">Recent peer reviews (public)</p>
              <Link
                href={`/users/${encodeURIComponent(repResolvedId)}/feedback`}
                className="mt-2 inline-block text-xs font-medium text-teal-800 hover:underline"
              >
                Open full feedback page
              </Link>
              {repReviews.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">No written reviews yet for this user.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {repReviews.map((rv) => (
                    <li key={rv.id} className="rounded-md border border-slate-200 bg-white p-2 text-xs text-slate-700">
                      <span className="font-semibold text-amber-800">★ {Number(rv.rating) || 0}</span>
                      {rv.comment ? (
                        <span className="mt-1 block text-slate-700">{String(rv.comment).slice(0, 400)}</span>
                      ) : null}
                      <span className="mt-1 block text-[10px] text-slate-400">
                        From{" "}
                        {formatIdentityPriority({
                          username: rv.reviewer_username ?? null,
                          display_name: rv.reviewer_display_name ?? null,
                          email: null,
                          id: rv.reviewer_id,
                        })}{" "}
                        · booking {rv.booking_id.slice(0, 8)}… · {new Date(rv.created_at).toLocaleString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </section>

        {token ? (
          <>
            <section className="mt-8 rounded-xl border border-slate-200 bg-white/80 p-6 shadow-sm">
              <h2 className="text-lg font-medium text-slate-900">Report abuse</h2>
              <form onSubmit={onReport} className="mt-4 space-y-3">
                <div className="flex gap-4 text-sm text-slate-700">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="abuseType"
                      checked={abuseType === "listing"}
                      onChange={() => setAbuseType("listing")}
                    />
                    Listing
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="abuseType"
                      checked={abuseType === "user"}
                      onChange={() => setAbuseType("user")}
                    />
                    User
                  </label>
                </div>
                <input
                  value={abuseTarget}
                  onChange={(e) => setAbuseTarget(e.target.value)}
                  placeholder={
                    abuseType === "listing"
                      ? "Listing ID (from the listing page URL)"
                      : "@username or display name"
                  }
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
                  required
                />
                <input
                  value={abuseCategory}
                  onChange={(e) => setAbuseCategory(e.target.value)}
                  placeholder="category"
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
                />
                <textarea
                  value={abuseDetails}
                  onChange={(e) => setAbuseDetails(e.target.value)}
                  placeholder="details (optional)"
                  rows={3}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-md border border-red-200 bg-red-50 px-4 py-2 font-medium text-red-800 hover:bg-red-100 disabled:opacity-50"
                >
                  Submit report
                </button>
              </form>
            </section>

            <section className="mt-8 rounded-xl border border-slate-200 bg-white/80 p-6 shadow-sm">
              <h2 className="text-lg font-medium text-slate-900">Peer review</h2>
              <p className="mt-1 text-xs text-slate-600">
                The booking list comes from{" "}
                <code className="rounded bg-slate-100 px-1">GET /bookings/mine?peer_review_eligible=1</code> —{" "}
                <strong className="font-medium">APPROVED</strong> bookings (landlord accepted),{" "}
                <strong className="font-medium">CONFIRMED</strong> stays, and <strong className="font-medium">COMPLETED</strong> stays.
                Cancelled, rejected, expired, and withdrawn-style requests are excluded. After you pick a booking, the
                other party is pre-filled from booking snapshots (handle, email hint, or short id), then refined from the
                public user directory when available. Public feedback uses the same peer-review-eligible booking rule.
              </p>
              <form onSubmit={onPeerReview} className="mt-4 space-y-3">
                <label className="block text-xs font-medium text-slate-600">Booking</label>
                <select
                  value={bookingId}
                  onChange={(e) => setBookingId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
                  required
                >
                  <option value="">Select…</option>
                  {myBookings.map((b) => {
                    const renterHint =
                      formatBookingCounterpartyHint(b, mySub || "") ||
                      handleHintFromEmail(b.tenant_email) ||
                      "Other party";
                    return (
                      <option key={b.booking_id} value={b.booking_id}>
                        {prettyBookingTitle(b.listing?.title ?? b.listing_title)} · {b.status} · {renterHint} ·{" "}
                        {b.startDate}
                      </option>
                    );
                  })}
                </select>
                <label className="block text-xs font-medium text-slate-600">Reviewee (other party)</label>
                <input
                  value={revieweeQuery}
                  onChange={(e) => setRevieweeQuery(e.target.value)}
                  placeholder="Pre-filled from booking, or @username / display name"
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
                  required
                />
                <input
                  value={side}
                  onChange={(e) => setSide(e.target.value)}
                  placeholder="Optional: tenant | landlord | host (defaults from booking)"
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
                />
                <div>
                  <label className="text-xs text-slate-600">Rating 1–5</label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={rating}
                    onChange={(e) => setRating(Number(e.target.value))}
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm"
                  />
                </div>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="comment"
                  rows={2}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-md bg-slate-700 px-4 py-2 font-medium text-white hover:bg-slate-600 disabled:opacity-50"
                >
                  Submit review
                </button>
              </form>
            </section>
          </>
        ) : (
          <p className="mt-8 text-sm text-slate-600">
            <Link href="/login" className="font-medium text-teal-700 hover:underline">
              Log in
            </Link>{" "}
            to report abuse or submit peer reviews.
          </p>
        )}

        {msg && <p className="mt-6 text-sm font-medium text-emerald-700">{msg}</p>}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </main>
    </div>
  );
}
