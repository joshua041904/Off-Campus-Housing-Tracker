"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { formatUserDisplayName, handleHintFromEmail } from "@/lib/user-display";
import { BookingListingInline } from "@/components/BookingListingInline";
import { fraudCaseAction, listFraudCases, type FraudCaseRow } from "@/lib/api";

function fraudBadgeClasses(score: number): string {
  if (score <= 39) return "bg-emerald-100 text-emerald-900 border-emerald-300";
  if (score <= 59) return "bg-amber-100 text-amber-950 border-amber-300";
  if (score <= 79) return "bg-red-100 text-red-950 border-red-400";
  return "bg-red-950 text-white border-red-950";
}

function formatAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const h = Math.floor(ms / 3_600_000);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function FraudDashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [cases, setCases] = useState<FraudCaseRow[]>([]);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const t = getStoredToken();
    const em = getStoredEmail();
    if (!t) {
      if (typeof window !== "undefined") window.location.replace("/login");
      return;
    }
    setToken(t);
    setEmail(em);
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await listFraudCases(token, { page, pageSize: 24, minScore: 60 });
      setCases(res.cases);
      setTotalPages(res.totalPages);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load fraud cases");
    } finally {
      setLoading(false);
    }
  }, [token, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const onAction = async (bookingId: string, action: "reviewed" | "ignore" | "ban") => {
    if (!token) return;
    setBusyId(bookingId);
    setError(null);
    try {
      await fraudCaseAction(token, bookingId, action);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-50/80 to-white pb-16">
      <Nav email={email} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Trust · Operations</p>
            <h1 className="text-2xl font-bold text-slate-900">Fraud cases</h1>
            <p className="mt-1 max-w-xl text-sm text-slate-600">
              High-risk booking requests for your listings (landlords) or platform-wide (configured fraud admins).
            </p>
          </div>
          <Link href="/dashboard/moderation" className="text-sm font-medium text-teal-700 hover:text-teal-900">
            ← Moderation home
          </Link>
        </div>

        {error ? (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-600">Loading cases…</p>
        ) : cases.length === 0 ? (
          <p className="text-sm text-slate-600">No open fraud cases match the current filters.</p>
        ) : (
          <ul className="space-y-4">
            {cases.map((c) => (
              <li key={c.booking_id} className="border rounded-lg bg-white p-4 shadow-sm space-y-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded border px-2 py-0.5 text-xs font-semibold ${fraudBadgeClasses(c.fraud_score)}`}>
                      Fraud score: {c.fraud_score}
                    </span>
                    {c.fraud_flagged ? (
                      <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white">Flagged</span>
                    ) : null}
                  </div>
                  <span className="text-xs text-slate-500">{formatAgo(c.created_at)}</span>
                </div>
                <BookingListingInline listing={c.listing} fallbackTitle={c.listing_title} />
                <p className="text-sm text-slate-700">
                  <span className="text-slate-500">Tenant:</span>{" "}
                  {formatUserDisplayName(
                    null,
                    c.tenant_display || handleHintFromEmail(c.tenant_email),
                    "Renter",
                  )}
                </p>
                <ul className="text-sm list-disc pl-5 text-slate-700">
                  {c.signals.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
                <div className="flex flex-wrap gap-2 pt-2">
                  <button
                    type="button"
                    disabled={busyId === c.booking_id}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                    onClick={() => void onAction(c.booking_id, "reviewed")}
                  >
                    Mark reviewed
                  </button>
                  <button
                    type="button"
                    disabled={busyId === c.booking_id}
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    onClick={() => void onAction(c.booking_id, "ignore")}
                  >
                    Ignore
                  </button>
                  <button
                    type="button"
                    disabled={busyId === c.booking_id}
                    className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                    onClick={() => void onAction(c.booking_id, "ban")}
                  >
                    Ban tenant
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {totalPages > 1 ? (
          <div className="mt-8 flex items-center gap-3">
            <button
              type="button"
              className="rounded border px-3 py-1 text-sm disabled:opacity-40"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Prev
            </button>
            <span className="text-sm text-slate-600">
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              className="rounded border px-3 py-1 text-sm disabled:opacity-40"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
}
