"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BookingListingInline } from "@/components/BookingListingInline";
import { Nav } from "@/components/Nav";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import {
  acceptBooking,
  getModerationDashboard,
  listCommunityReports,
  patchCommunityReport,
  transitionBookingStatus,
  type CommunityReportRow,
  type PendingBookingRow,
} from "@/lib/api";
import { formatAtUsername } from "@/lib/user-display";

function fraudBadgeClasses(score: number): string {
  if (score <= 39) return "bg-emerald-50 text-emerald-900";
  if (score <= 59) return "bg-amber-50 text-amber-950";
  if (score <= 79) return "bg-red-50 text-red-950";
  return "bg-red-950 text-white";
}

export default function ModerationDashboardPage() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [dash, setDash] = useState<{ pendingBookings: number; fraudFlags: number; communityReports: number } | null>(
    null,
  );
  const [pendingRows, setPendingRows] = useState<PendingBookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyBooking, setBusyBooking] = useState<string | null>(null);
  const [communityReportRows, setCommunityReportRows] = useState<CommunityReportRow[]>([]);
  const [busyReport, setBusyReport] = useState<string | null>(null);

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
      const d = await getModerationDashboard(token);
      setDash({
        pendingBookings: d.pendingBookings,
        fraudFlags: d.fraudFlags,
        communityReports: d.communityReports,
      });
      setPendingRows(d.pendingBookingRows ?? []);
      try {
        const cr = await listCommunityReports(token);
        setCommunityReportRows(cr.reports);
      } catch {
        setCommunityReportRows([]);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load moderation summary");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const actOnBooking = async (bookingId: string, kind: "accept" | "reject") => {
    if (!token) return;
    setBusyBooking(bookingId);
    setError(null);
    try {
      if (kind === "accept") await acceptBooking(token, bookingId);
      else await transitionBookingStatus(token, bookingId, "REJECTED");
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Booking action failed");
    } finally {
      setBusyBooking(null);
    }
  };

  const actOnReport = async (reportId: string, status: "resolved" | "dismissed") => {
    if (!token) return;
    setBusyReport(reportId);
    setError(null);
    try {
      await patchCommunityReport(token, reportId, status);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Report update failed");
    } finally {
      setBusyReport(null);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white pb-16">
      <Nav email={email} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">Moderation</h1>
          <p className="mt-1 text-sm text-slate-600">Landlord queue for bookings, fraud alerts, and community signals.</p>
        </div>

        {error ? (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</div>
        ) : null}

        {loading || !dash ? (
          <p className="text-sm text-slate-600">Loading…</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase text-slate-500">Pending requests</p>
              <p className="mt-1 text-3xl font-bold text-slate-900">{dash.pendingBookings}</p>
            </div>
            <Link
              href="/dashboard/fraud"
              className="rounded-lg border bg-white p-4 shadow-sm transition hover:border-teal-400 hover:bg-teal-50/40"
            >
              <p className="text-xs font-semibold uppercase text-slate-500">Fraud alerts</p>
              <p className="mt-1 text-3xl font-bold text-red-700">{dash.fraudFlags}</p>
              <p className="mt-2 text-xs text-teal-700">Open fraud dashboard →</p>
            </Link>
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase text-slate-500">Community reports</p>
              <p className="mt-1 text-3xl font-bold text-slate-900">{dash.communityReports}</p>
              <p className="mt-2 text-xs text-slate-500">Reports on your listings (pending triage)</p>
            </div>
          </div>
        )}

        <section className="mt-12">
          <h2 className="text-lg font-semibold text-slate-900">Community reports (your listings)</h2>
          <p className="mt-1 text-sm text-slate-600">Pending reports from renters on listings you own.</p>
          <ul className="mt-4 space-y-3">
            {communityReportRows.length === 0 ? (
              <li className="text-sm text-slate-500">No pending community reports.</li>
            ) : (
              communityReportRows.map((r) => (
                <li
                  key={r.id}
                  className="rounded-lg border bg-white px-4 py-3 shadow-sm"
                >
                  <p className="text-sm font-medium text-slate-900">{r.listing_title || r.listing_id}</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Report {r.id.slice(0, 8)}… · {new Date(r.created_at).toLocaleString()}
                  </p>
                  <p className="mt-2 text-sm text-slate-800">{r.reason || "(no reason text)"}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busyReport === r.id}
                      className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
                      onClick={() => void actOnReport(r.id, "resolved")}
                    >
                      Resolve
                    </button>
                    <button
                      type="button"
                      disabled={busyReport === r.id}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      onClick={() => void actOnReport(r.id, "dismissed")}
                    >
                      Dismiss
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="text-lg font-semibold text-slate-900">Pending booking requests</h2>
          <p className="mt-1 text-sm text-slate-600">Accept or reject tour requests; fraud score shown inline.</p>
          <ul className="mt-4 space-y-3">
            {pendingRows.length === 0 ? (
              <li className="text-sm text-slate-500">No pending bookings.</li>
            ) : (
              pendingRows.map((row) => (
                <li
                  key={row.booking_id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white px-4 py-3 shadow-sm"
                >
                  <div className="min-w-0 max-w-md">
                    <BookingListingInline listing={row.listing} fallbackTitle={row.listing_title} />
                    <p className="mt-2 text-xs text-slate-500">
                      Renter {row.renter_handle ? formatAtUsername(row.renter_handle) : "—"}
                    </p>
                    {row.startDate && row.endDate ? (
                      <p className="text-xs text-slate-600">
                        {row.startDate} → {row.endDate} · {row.duration_days ?? "—"} days
                      </p>
                    ) : null}
                    {row.expires_at && row.status === "PENDING" ? (
                      <p className="text-xs text-amber-700">Expires {new Date(row.expires_at).toLocaleString()}</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${fraudBadgeClasses(row.fraud_score)}`}>
                      Fraud {row.fraud_score}
                    </span>
                    <button
                      type="button"
                      disabled={busyBooking === row.booking_id}
                      className="rounded-md bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
                      onClick={() => void actOnBooking(row.booking_id, "accept")}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      disabled={busyBooking === row.booking_id}
                      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                      onClick={() => void actOnBooking(row.booking_id, "reject")}
                    >
                      Reject
                    </button>
                  </div>
                </li>
              ))
            )}
          </ul>
        </section>
      </main>
    </div>
  );
}
