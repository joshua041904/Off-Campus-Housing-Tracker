"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BookingListingInline } from "@/components/BookingListingInline";
import { Nav } from "@/components/Nav";
import { listMyBookings, tenantArchiveBooking, type TenantBookingSummary } from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { getSubFromJwt } from "@/lib/jwt-sub";
import { prettyBookingStatus, prettyBookingTitle } from "@/lib/listing-display";
import { partitionBookingsUpcomingPast } from "@/lib/booking-mine-partition";
import { formatHostCounterpartyLine, formatRenterCounterpartyLine } from "@/lib/user-display";

function formatDate(iso: string): string {
  try {
    return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function exclusiveNights(start: string, end: string): number {
  if (!start || !end) return 0;
  const a = new Date(`${start}T00:00:00.000Z`).getTime();
  const b = new Date(`${end}T00:00:00.000Z`).getTime();
  if (!(a < b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

export default function DashboardBookingsPage() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [bookings, setBookings] = useState<TenantBookingSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [actingId, setActingId] = useState<string | null>(null);
  const myId = useMemo(() => {
    const raw = getSubFromJwt(token);
    return raw && /^[0-9a-f-]{36}$/i.test(raw) ? raw.toLowerCase() : "";
  }, [token]);

  function counterpartyLabel(b: TenantBookingSummary): string {
    const tid = String(b.tenant_id || "").trim().toLowerCase();
    const lid = String(b.landlord_id || "").trim().toLowerCase();
    if (!myId || (!tid && !lid)) return "";
    if (tid === myId && lid) {
      return formatHostCounterpartyLine({
        landlord_display: b.landlord_display,
        listing_landlord_display: b.listing?.landlord_display,
        landlord_id: lid,
        landlord_email: b.landlord_email,
      });
    }
    if (lid === myId && tid) {
      return formatRenterCounterpartyLine({
        renter_username: b.renter_username,
        renter_display_name: b.renter_display_name,
        renter_display: b.renter_display,
        tenant_email: b.tenant_email,
        tenant_id: tid,
      });
    }
    return "";
  }

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

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoading(true);
    listMyBookings(token, { includeArchived: showArchived, role: "tenant", view: "all" })
      .then((rows) => {
        if (!cancelled) {
          setError(null);
          setBookings(rows);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load bookings");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, showArchived]);

  const { upcoming, past } = useMemo(
    () => partitionBookingsUpcomingPast(bookings, { includeHidden: showArchived }),
    [bookings, showArchived],
  );

  async function dismissPending(bookingId: string) {
    if (!token) return;
    setActingId(bookingId);
    setError(null);
    try {
      await tenantArchiveBooking(token, bookingId);
      const rows = await listMyBookings(token, {
        includeArchived: showArchived,
        role: "tenant",
        view: "all",
      });
      setError(null);
      setBookings(rows);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not remove booking");
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-emerald-50/40 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="font-serif text-3xl text-slate-900">My bookings</h1>
        <p className="mt-2 text-sm text-slate-600">
          Upcoming and past booking activity.{" "}
          <Link href="/dashboard" className="font-medium text-teal-700 hover:underline">
            Search dashboard
          </Link>
        </p>

        <label className="mt-6 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="rounded border-slate-300"
          />
          Show hidden bookings
        </label>

        {loading ? <p className="mt-6 text-sm text-slate-600">Loading bookings...</p> : null}
        {error ? <p className="mt-6 text-sm text-red-700">{error}</p> : null}

        {!loading && !error && bookings.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-600">
            No bookings yet. Open a listing and request a date range to get started.
          </div>
        ) : null}

        {upcoming.length > 0 ? (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-slate-900">Upcoming</h2>
            <ul className="mt-3 space-y-4">
              {upcoming.map((b) => (
                <li key={b.booking_id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <BookingListingInline
                    listing={b.listing}
                    fallbackTitle={prettyBookingTitle(b.listing_title || undefined)}
                  />
                  <p className="mt-2 text-sm text-slate-700">
                    {formatDate(b.startDate)} - {formatDate(b.endDate)} (
                    {exclusiveNights(b.startDate, b.endDate) || b.duration_days} nights)
                  </p>
                  <p className="text-sm text-slate-700">Status: {prettyBookingStatus(b.status)}</p>
                  {counterpartyLabel(b) ? (
                    <p className="text-xs text-slate-600">{counterpartyLabel(b)}</p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href={`/dashboard/bookings/${b.booking_id}`}
                      className="inline-block text-sm font-medium text-teal-700 hover:underline"
                    >
                      View booking details
                    </Link>
                    {["PENDING", "ACCEPTED"].includes(String(b.status || "").trim().toUpperCase()) ? (
                      <button
                        type="button"
                        disabled={actingId === (b.booking_id || b.id)}
                        onClick={() =>
                          void dismissPending(String(b.booking_id || b.id || "").trim())
                        }
                        className="rounded-md border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-800 hover:bg-rose-50 disabled:opacity-50"
                      >
                        {actingId === (b.booking_id || b.id)
                          ? "Removing…"
                          : String(b.status || "").trim().toUpperCase() === "ACCEPTED"
                            ? "Withdraw request & remove"
                            : "Cancel & remove from list"}
                      </button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {past.length > 0 ? (
          <section className="mt-10">
            <h2 className="text-lg font-semibold text-slate-900">Past</h2>
            <ul className="mt-3 space-y-3">
              {past.map((b) => (
                <li key={b.booking_id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-medium text-slate-900">{prettyBookingTitle(b.listing_title || undefined)}</p>
                  <p className="text-xs text-slate-600">
                    {formatDate(b.startDate)} - {formatDate(b.endDate)} ·{" "}
                    {exclusiveNights(b.startDate, b.endDate) || b.duration_days} nights · {prettyBookingStatus(b.status)}
                    {counterpartyLabel(b) ? (
                      <>
                        <br />
                        <span className="text-slate-700">{counterpartyLabel(b)}</span>
                      </>
                    ) : null}
                  </p>
                  <Link
                    href={`/dashboard/bookings/${b.booking_id}`}
                    className="mt-2 inline-block text-xs font-medium text-teal-700 hover:underline"
                  >
                    View details
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}

