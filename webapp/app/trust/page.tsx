"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getReputation, reportAbuse, submitPeerReview } from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { getSubFromJwt } from "@/lib/jwt-sub";
import { Nav } from "@/components/Nav";

const inputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500";

const monoInputClass =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500";

export default function TrustPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [mySub, setMySub] = useState<string | null>(null);

  const [repUserId, setRepUserId] = useState("");
  const [repScore, setRepScore] = useState<number | null>(null);

  const [abuseType, setAbuseType] = useState<"listing" | "user">("listing");
  const [abuseTarget, setAbuseTarget] = useState("");
  const [abuseCategory, setAbuseCategory] = useState("spam");
  const [abuseDetails, setAbuseDetails] = useState("");

  const [bookingId, setBookingId] = useState("");
  const [revieweeId, setRevieweeId] = useState("");
  const [side, setSide] = useState("guest");
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
    if (sub) setRepUserId(sub);
  }, []);

  async function onReputation(e: React.FormEvent) {
    e.preventDefault();
    if (!repUserId.trim()) return;
    setErr(null);
    setLoading(true);
    try {
      const r = await getReputation(repUserId.trim());
      setRepScore(r.score);
      setMsg(`Reputation for ${r.user_id}: ${r.score}`);
    } catch (e: unknown) {
      setRepScore(null);
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
      await reportAbuse(token, {
        abuse_target_type: abuseType,
        target_id: abuseTarget.trim(),
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
      await submitPeerReview(token, {
        booking_id: bookingId.trim(),
        reviewee_id: revieweeId.trim(),
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
          Report abuse and submit peer reviews via gateway → trust-service. Reputation lookup is public.
        </p>

        <section className="mt-10 rounded-xl border border-slate-200 bg-white/80 p-6 shadow-sm">
          <h2 className="text-lg font-medium text-slate-900">Reputation</h2>
          <form
            data-testid="trust-reputation-form"
            onSubmit={onReputation}
            className="mt-4 flex flex-col gap-3 sm:flex-row"
          >
            <input
              data-testid="trust-reputation-user-id"
              value={repUserId}
              onChange={(e) => setRepUserId(e.target.value)}
              placeholder="user UUID"
              className={`flex-1 ${monoInputClass}`}
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
          {mySub && (
            <button
              type="button"
              className="mt-2 text-xs font-medium text-teal-700 hover:underline"
              onClick={() => setRepUserId(mySub)}
            >
              Use my account id
            </button>
          )}
          {repScore != null && (
            <p data-testid="trust-reputation-score" className="mt-4 text-sm text-slate-600">
              Score: <strong className="text-teal-800">{repScore}</strong>
            </p>
          )}
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
                  placeholder="target UUID"
                  className={monoInputClass}
                  required
                />
                <input
                  value={abuseCategory}
                  onChange={(e) => setAbuseCategory(e.target.value)}
                  placeholder="category"
                  className={inputClass}
                />
                <textarea
                  value={abuseDetails}
                  onChange={(e) => setAbuseDetails(e.target.value)}
                  placeholder="details (optional)"
                  rows={3}
                  className={inputClass}
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
                After a booking — both sides can leave a review (unique per booking/reviewer).
              </p>
              <form onSubmit={onPeerReview} className="mt-4 space-y-3">
                <input
                  value={bookingId}
                  onChange={(e) => setBookingId(e.target.value)}
                  placeholder="booking UUID"
                  className={monoInputClass}
                  required
                />
                <input
                  value={revieweeId}
                  onChange={(e) => setRevieweeId(e.target.value)}
                  placeholder="reviewee user UUID"
                  className={monoInputClass}
                  required
                />
                <input
                  value={side}
                  onChange={(e) => setSide(e.target.value)}
                  placeholder="side label e.g. guest | host"
                  className={inputClass}
                />
                <div>
                  <label className="text-xs text-slate-600">Rating 1–5</label>
                  <input
                    type="number"
                    min={1}
                    max={5}
                    value={rating}
                    onChange={(e) => setRating(Number(e.target.value))}
                    className={`mt-1 ${inputClass}`}
                  />
                </div>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="comment"
                  rows={2}
                  className={inputClass}
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-md bg-teal-600 px-4 py-2 font-medium text-white hover:bg-teal-500 disabled:opacity-50"
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