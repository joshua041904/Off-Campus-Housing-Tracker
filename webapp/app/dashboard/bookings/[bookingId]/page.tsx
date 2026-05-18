"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BookingListingInline } from "@/components/BookingListingInline";
import { Nav } from "@/components/Nav";
import {
  cancelBookingAsTenant,
  getBookingForUser,
  tenantArchiveBooking,
  tenantUnarchiveBooking,
  transitionBookingStatus,
  type BookingDetailPayload,
} from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import {
  bookingDashboardHrefForDetail,
  bookingStatusForActions,
  landlordCanRespondToBooking,
} from "@/lib/booking-detail-state";
import { getSubFromJwt } from "@/lib/jwt-sub";
import { prettyBookingStatus, prettyBookingTitle } from "@/lib/listing-display";
import { markBookingNotificationContextReadAndDispatch } from "@/lib/mark-booking-notification-context-read";
import { notificationIdFromSearch } from "@/lib/notification-booking";
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

function normId(s: string | undefined | null): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(t) ? t.toLowerCase() : t;
}

export default function BookingDetailPage() {
  const params = useParams<{ bookingId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const bookingId = params?.bookingId || "";
  const searchString = searchParams.toString();
  const sourceRole = searchParams.get("role") || searchParams.get("from");
  const explicitNotificationId = notificationIdFromSearch(searchString ? `?${searchString}` : "");
  const [sessionReady, setSessionReady] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [detail, setDetail] = useState<BookingDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const consumedBookingReadRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const t = getStoredToken();
    setEmail(getStoredEmail());
    setToken(t);
    setSessionReady(true);
    if (!t && typeof window !== "undefined") {
      window.location.replace("/login");
    }
  }, []);

  const myId = getSubFromJwt(token);

  const load = useCallback(async () => {
    if (!token || !bookingId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await getBookingForUser(token, bookingId);
      setDetail(d);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load booking");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [token, bookingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const role =
    myId && detail
      ? normId(myId) === normId(detail.tenant_id ?? detail.tenantId)
        ? "tenant"
        : normId(myId) === normId(detail.landlord_id ?? detail.landlordId)
          ? "landlord"
          : "other"
      : "other";

  const dashboardHref = bookingDashboardHrefForDetail({ sourceRole, role });
  const dashboardLabel =
    dashboardHref === "/dashboard/landlord"
      ? "Landlord dashboard"
      : dashboardHref === "/dashboard/bookings"
        ? "My bookings"
        : "Dashboard";

  /** Mark every notification row for this booking context read (not only ?nid=). */
  useEffect(() => {
    if (!token || !bookingId) return;
    const key = bookingId.toLowerCase();
    if (consumedBookingReadRef.current.has(key)) return;
    consumedBookingReadRef.current.add(key);
    let cancelled = false;
    void markBookingNotificationContextReadAndDispatch(token, {
      bookingId,
      notificationId: explicitNotificationId,
      audience: role === "landlord" ? "landlord" : role === "tenant" ? "tenant" : "unknown",
    }).then(() => {
      if (cancelled || typeof window === "undefined") return;
      router.refresh();
      if (!explicitNotificationId) return;
      const nextParams = new URLSearchParams(searchString);
      nextParams.delete("nid");
      const nextSearch = nextParams.toString();
      router.replace(
        `/dashboard/bookings/${encodeURIComponent(bookingId)}${nextSearch ? `?${nextSearch}` : ""}`,
        { scroll: false },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [bookingId, explicitNotificationId, role, router, searchString, token]);

  const st = bookingStatusForActions(detail?.status);
  const canTenantCancel = role === "tenant" && ["PENDING", "ACCEPTED", "CONFIRMED"].includes(st);
  const nights = detail ? exclusiveNights(detail.startDate, detail.endDate) || detail.duration_days : 0;

  async function onCancel() {
    if (!token || !bookingId || !canTenantCancel) return;
    if (!window.confirm("Cancel this booking?")) return;
    setActing(true);
    setError(null);
    try {
      await cancelBookingAsTenant(token, bookingId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Cancel failed");
    } finally {
      setActing(false);
    }
  }

  async function onArchive() {
    if (!token || !bookingId) return;
    setActing(true);
    setError(null);
    try {
      await tenantArchiveBooking(token, bookingId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Archive failed");
    } finally {
      setActing(false);
    }
  }

  async function onUnarchive() {
    if (!token || !bookingId) return;
    setActing(true);
    setError(null);
    try {
      await tenantUnarchiveBooking(token, bookingId);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setActing(false);
    }
  }

  async function landlordMove(to: "ACCEPTED" | "REJECTED") {
    if (!token || !bookingId) return;
    setActing(true);
    setError(null);
    try {
      await transitionBookingStatus(token, bookingId, to);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setActing(false);
    }
  }

  async function tenantConfirmBooking() {
    if (!token || !bookingId || role !== "tenant" || st !== "ACCEPTED") return;
    if (!window.confirm("Confirm this booking? You agree to proceed after the landlord accepted your request.")) return;
    setActing(true);
    setError(null);
    try {
      await transitionBookingStatus(token, bookingId, "CONFIRMED");
      await load();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("och:badges-refresh"));
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Confirm failed");
    } finally {
      setActing(false);
    }
  }

  if (!sessionReady || !token) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <Nav email={email} />
        <main className="mx-auto max-w-3xl px-4 py-8">
          <p className="text-sm text-slate-600">{!sessionReady ? "Loading…" : "Redirecting to sign in…"}</p>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <p className="text-sm text-slate-600">
          <Link href={dashboardHref} className="font-medium text-teal-700 hover:underline">
            ← {dashboardLabel}
          </Link>
        </p>

        {loading ? <p className="mt-6 text-sm text-slate-600">Loading booking…</p> : null}
        {error ? <p className="mt-6 text-sm text-rose-700">{error}</p> : null}

        {!loading && detail && role === "other" ? (
          <p className="mt-6 text-sm text-slate-700">You do not have access to this booking.</p>
        ) : null}

        {!loading && detail && role !== "other" ? (
          <div className="mt-6 space-y-6">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                {prettyBookingTitle(detail.listing_title || detail.listing?.title || undefined)}
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                {formatDate(detail.startDate)} – {formatDate(detail.endDate)} · {nights} nights
              </p>
              <p className="mt-2 text-sm font-medium text-slate-800">Status: {prettyBookingStatus(detail.status)}</p>
              {role === "tenant" && (detail.landlord_id || detail.landlordId) ? (
                <p className="mt-1 text-xs text-slate-600">
                  {formatHostCounterpartyLine({
                    landlord_display: detail.landlord_display,
                    listing_landlord_display: (detail.listing as { landlord_display?: string } | undefined)
                      ?.landlord_display,
                    landlord_id: String(detail.landlord_id || detail.landlordId || ""),
                    landlord_email: (detail as { landlord_email?: string | null }).landlord_email,
                  })}
                </p>
              ) : null}
              {role === "landlord" ? (
                <p className="mt-1 text-xs text-slate-600">
                  {formatRenterCounterpartyLine({
                    renter_username: detail.renter_username,
                    renter_display_name: detail.renter_display_name,
                    renter_display: detail.renter_display,
                    tenant_email: detail.tenant_email,
                    tenant_id: String(detail.tenant_id || detail.tenantId || ""),
                  })}
                </p>
              ) : null}
              {detail.listing?.id ? (
                <Link
                  href={`/listings/${detail.listing.id}`}
                  className="mt-2 inline-block text-sm font-medium text-teal-700 hover:underline"
                >
                  View listing
                </Link>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <BookingListingInline
                listing={detail.listing}
                fallbackTitle={prettyBookingTitle(detail.listing_title || undefined)}
              />
            </div>

            {role === "tenant" ? (
              <div className="space-y-4">
                {st === "ACCEPTED" ? (
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 shadow-sm">
                    <p className="text-sm font-medium text-emerald-950">The landlord accepted your request.</p>
                    <p className="mt-1 text-xs text-emerald-900">
                      Confirm to finalize this booking on your side (status becomes confirmed).
                    </p>
                    <button
                      type="button"
                      disabled={acting}
                      onClick={() => void tenantConfirmBooking()}
                      className="mt-3 rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
                    >
                      {acting ? "Working…" : "Confirm booking"}
                    </button>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-3">
                {canTenantCancel ? (
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => void onCancel()}
                    className="rounded-md border border-rose-300 bg-white px-4 py-2 text-sm font-medium text-rose-800 hover:bg-rose-50 disabled:opacity-50"
                  >
                    Cancel booking
                  </button>
                ) : null}
                {detail.tenant_archived_at ? (
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => void onUnarchive()}
                    className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    Restore to my list
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={acting}
                    onClick={() => void onArchive()}
                    className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Hide from my list
                  </button>
                )}
              </div>
            </div>
            ) : null}

            {role === "landlord" ? (
              <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                {landlordCanRespondToBooking(st) ? (
                  <>
                    <p className="text-sm text-slate-700">Respond to this booking request.</p>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => void landlordMove("ACCEPTED")}
                        className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        disabled={acting}
                        onClick={() => void landlordMove("REJECTED")}
                        className="rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                      >
                        Reject
                      </button>
                      {detail.tenant_id ? (
                        <Link
                          href={`/dashboard/messages?to=${encodeURIComponent(detail.tenant_id)}`}
                          className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                        >
                          Message renter
                        </Link>
                      ) : null}
                    </div>
                  </>
                ) : st === "ACCEPTED" ? (
                  <p className="text-sm text-slate-700">
                    You accepted this request. Waiting for the renter to confirm the booking on their side.
                  </p>
                ) : (
                  <p className="text-sm text-slate-700">
                    No landlord decision is required for this status ({prettyBookingStatus(detail.status)}).
                  </p>
                )}
                {detail.tenant_id && st !== "PENDING" ? (
                  <Link
                    href={`/dashboard/messages?to=${encodeURIComponent(detail.tenant_id)}`}
                    className="inline-flex items-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
                  >
                    Message renter
                  </Link>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}
