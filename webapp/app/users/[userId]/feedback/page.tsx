"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import {
  getReputation,
  listUserTrustReviews,
  type TrustReviewRow,
} from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { getSubFromJwt } from "@/lib/jwt-sub";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function shortId(id: string): string {
  const s = String(id || "").trim();
  if (s.length <= 12) return s;
  return `${s.slice(0, 8)}…`;
}

function stars(n: number): string {
  const r = Math.min(5, Math.max(0, Math.round(n)));
  return `${"★".repeat(r)}${"☆".repeat(5 - r)}`;
}

export default function UserFeedbackPage() {
  const params = useParams<{ userId: string }>();
  const userId = String(params?.userId || "").trim();
  const validId = useMemo(() => UUID_RE.test(userId), [userId]);

  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [tab, setTab] = useState<"received" | "written">("received");
  const [rep, setRep] = useState<{ avg: number | null; count: number; score: number } | null>(null);
  const [received, setReceived] = useState<TrustReviewRow[]>([]);
  const [written, setWritten] = useState<TrustReviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selfId = useMemo(() => getSubFromJwt(token), [token]);

  useEffect(() => {
    setToken(getStoredToken());
    setEmail(getStoredEmail());
  }, []);

  useEffect(() => {
    if (!validId) {
      setLoading(false);
      setError("Invalid profile id.");
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [r, recv, wrote] = await Promise.all([
          getReputation(userId),
          listUserTrustReviews(userId, { direction: "received", limit: 80 }),
          listUserTrustReviews(userId, { direction: "written", limit: 80 }),
        ]);
        if (cancelled) return;
        setRep({
          avg: r.avg_rating ?? null,
          count: r.review_count ?? 0,
          score: r.score ?? 0,
        });
        setReceived(recv.items);
        setWritten(wrote.items);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load reviews");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, validId]);

  const rows = tab === "received" ? received : written;

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-indigo-50/40 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-slate-600">
          <Link href="/listings" className="font-medium text-teal-700 hover:underline">
            ← Listings
          </Link>
          {selfId === userId ? (
            <>
              {" · "}
              <Link href="/dashboard/landlord" className="font-medium text-teal-700 hover:underline">
                Landlord dashboard
              </Link>
            </>
          ) : null}
        </p>
        <h1 className="mt-4 text-2xl font-semibold">Host profile & reputation</h1>
        <p className="mt-1 text-sm text-slate-600">
          Public star average, review count, and full review text from completed bookings. User id{" "}
          <span className="font-mono text-xs">{userId}</span>
          {selfId === userId ? <span className="ml-1 font-medium text-teal-800">(you)</span> : null}
        </p>

        {loading ? <p className="mt-6 text-sm text-slate-600">Loading…</p> : null}
        {error ? <p className="mt-6 text-sm text-rose-700">{error}</p> : null}

        {!loading && !error && validId && rep ? (
          <div className="mt-6 space-y-6">
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-sm font-semibold text-slate-800">Trust summary</h2>
              <p className="mt-2 text-sm text-slate-700">
                <span className="text-amber-500" aria-hidden>
                  {rep.avg != null && rep.count > 0 ? stars(rep.avg) : "☆☆☆☆☆"}
                </span>
                {rep.avg != null && rep.count > 0 ? (
                  <span className="ml-2 tabular-nums font-medium">{rep.avg.toFixed(1)} average</span>
                ) : (
                  <span className="ml-2 text-slate-500">No average yet</span>
                )}
                <span className="ml-2 text-slate-600">
                  · {rep.count} review{rep.count === 1 ? "" : "s"}
                </span>
              </p>
              <p className="mt-1 text-xs text-slate-500">Reputation score (internal): {rep.score}</p>
            </section>

            <div className="flex gap-2 border-b border-slate-200 pb-2 text-sm">
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 font-medium ${
                  tab === "received" ? "bg-teal-800 text-white" : "text-slate-700 hover:bg-slate-100"
                }`}
                onClick={() => setTab("received")}
              >
                Reviews about them ({received.length})
              </button>
              <button
                type="button"
                className={`rounded-md px-3 py-1.5 font-medium ${
                  tab === "written" ? "bg-teal-800 text-white" : "text-slate-700 hover:bg-slate-100"
                }`}
                onClick={() => setTab("written")}
              >
                Reviews they wrote ({written.length})
              </button>
            </div>

            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-6 text-sm text-slate-600">
                {tab === "received"
                  ? "No reviews yet — renters leave feedback after a completed stay."
                  : "This user has not submitted any written reviews yet."}
              </p>
            ) : (
              <ul className="space-y-4">
                {rows.map((rev) => (
                  <li key={rev.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-slate-900">
                        <span className="text-amber-500">{stars(rev.rating)}</span>
                        <span className="ml-2 tabular-nums">{rev.rating}/5</span>
                      </p>
                      <p className="text-xs text-slate-500">
                        {rev.created_at ? new Date(rev.created_at).toLocaleString() : "—"}
                      </p>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      Booking <span className="font-mono">{shortId(rev.booking_id)}</span>
                      {tab === "received" ? (
                        <>
                          {" · "}
                          From reviewer <span className="font-mono">{shortId(rev.reviewer_id)}</span>
                        </>
                      ) : (
                        <>
                          {" · "}
                          About <span className="font-mono">{shortId(rev.target_id)}</span> ({rev.target_type})
                        </>
                      )}
                    </p>
                    <p className="mt-3 whitespace-pre-wrap text-sm text-slate-800">
                      {rev.comment?.trim() ? rev.comment : <span className="text-slate-400">(No written comment)</span>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}
