"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  cancelBooking,
  confirmBooking,
  createBooking,
  getBooking,
  getListing,
  type BookingJson,
  type ListingJson,
  updateBookingTenantNotes,
} from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { Nav } from "@/components/Nav";

const TERMINAL_STATUSES = new Set(["cancelled", "completed", "expired"]);

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseUsdInputToCents(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed * 100);
}

function formatMoney(cents: number | null | undefined, currency = "USD") {
  if (cents == null || !Number.isFinite(cents)) return "Not provided";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDateLabel(value: string | null | undefined) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function formatDateTimeLabel(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function humanizeStatus(status: string | null | undefined) {
  if (!status) return "No booking selected";
  return status.replaceAll("_", " ");
}

function statusTone(status: string | null | undefined) {
  switch (status) {
    case "confirmed":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "cancelled":
    case "expired":
      return "border-red-200 bg-red-50 text-red-700";
    case "pending_confirmation":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "completed":
      return "border-slate-300 bg-slate-100 text-slate-700";
    default:
      return "border-teal-200 bg-teal-50 text-teal-800";
  }
}

function FeedbackBanner({
  message,
  error,
}: {
  message: string | null;
  error: string | null;
}) {
  return (
    <>
      {message ? (
        <div
          role="status"
          aria-live="polite"
          className="rounded-[1.25rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800 shadow-sm"
        >
          {message}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="rounded-[1.25rem] border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700 shadow-sm"
        >
          {error}
        </div>
      ) : null}
    </>
  );
}

export default function BookingPage() {
  const router = useRouter();
  const { authReady, token, email, isAuthenticated } = useAuth();

  const [listingId, setListingId] = useState("");
  const [startDate, setStartDate] = useState(() =>
    toDateInputValue(addDays(new Date(), 14)),
  );
  const [endDate, setEndDate] = useState(() =>
    toDateInputValue(addDays(new Date(), 379)),
  );
  const [landlordId, setLandlordId] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [tenantNotesDraft, setTenantNotesDraft] = useState("");
  const [bookingLookupId, setBookingLookupId] = useState("");

  const [activeBooking, setActiveBooking] = useState<BookingJson | null>(null);
  const [listingPreview, setListingPreview] = useState<ListingJson | null>(null);
  const [listingPreviewError, setListingPreviewError] = useState<string | null>(
    null,
  );

  const [busyAction, setBusyAction] = useState<
    "create" | "lookup" | "notes" | "confirm" | "cancel" | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const nextListingId =
      new URLSearchParams(window.location.search).get("listingId") ?? "";
    if (!nextListingId) return;
    setListingId((current) => (current === nextListingId ? current : nextListingId));
  }, []);

  useEffect(() => {
    if (!authReady) return;
    if (!isAuthenticated) {
      void router.replace("/login");
    }
  }, [authReady, isAuthenticated, router]);

  useEffect(() => {
    if (!activeBooking) {
      setListingPreview(null);
      setListingPreviewError(null);
      return;
    }

    let cancelled = false;
    setListingPreview(null);
    setListingPreviewError(null);

    void getListing(activeBooking.listingId)
      .then((listing) => {
        if (cancelled) return;
        setListingPreview(listing);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setListingPreviewError(
          err instanceof Error
            ? err.message
            : "Could not load listing details for this booking.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [activeBooking]);

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-sky-50 via-white to-emerald-50/40 text-slate-500">
        Loading booking tools…
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const canConfirm =
    activeBooking?.status === "created" ||
    activeBooking?.status === "pending_confirmation";
  const canCancel =
    activeBooking != null && !TERMINAL_STATUSES.has(activeBooking.status);
  const notesLocked =
    activeBooking != null && TERMINAL_STATUSES.has(activeBooking.status);

  async function handleCreateBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;

    setBusyAction("create");
    setMessage(null);
    setError(null);

    try {
      const created = await createBooking(token, {
        listingId: listingId.trim(),
        startDate,
        endDate,
        landlordId: landlordId.trim() || undefined,
        priceCents: parseUsdInputToCents(priceUsd),
      });

      const trimmedNotes = tenantNotesDraft.trim();
      const bookingWithNotes = trimmedNotes
        ? await updateBookingTenantNotes(token, created.id, trimmedNotes)
        : created;

      setActiveBooking(bookingWithNotes);
      setBookingLookupId(bookingWithNotes.id);
      setTenantNotesDraft(bookingWithNotes.tenantNotes ?? "");
      setMessage(
        trimmedNotes
          ? "Booking created and tenant notes saved."
          : "Booking created. You can now review, confirm, or update notes below.",
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Booking creation failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleLookupBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return;

    setBusyAction("lookup");
    setMessage(null);
    setError(null);

    try {
      const booking = await getBooking(token, bookingLookupId.trim());
      setActiveBooking(booking);
      setTenantNotesDraft(booking.tenantNotes ?? "");
      setMessage("Booking loaded.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load booking.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveNotes(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token || !activeBooking) return;

    setBusyAction("notes");
    setMessage(null);
    setError(null);

    try {
      const nextNotes = tenantNotesDraft.trim();
      const updated = await updateBookingTenantNotes(
        token,
        activeBooking.id,
        nextNotes ? nextNotes : null,
      );
      setActiveBooking(updated);
      setTenantNotesDraft(updated.tenantNotes ?? "");
      setMessage(
        nextNotes ? "Tenant notes updated." : "Tenant notes cleared.",
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update notes.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleConfirmBooking() {
    if (!token || !activeBooking) return;

    setBusyAction("confirm");
    setMessage(null);
    setError(null);

    try {
      const updated = await confirmBooking(token, {
        bookingId: activeBooking.id,
        landlordId: activeBooking.landlordId,
      });
      setActiveBooking(updated);
      setMessage("Booking confirmed.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not confirm booking.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCancelBooking() {
    if (!token || !activeBooking) return;

    setBusyAction("cancel");
    setMessage(null);
    setError(null);

    try {
      const updated = await cancelBooking(token, {
        bookingId: activeBooking.id,
        cancelledBy: "tenant",
      });
      setActiveBooking(updated);
      setMessage("Booking cancelled.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not cancel booking.");
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div
      className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.14),_transparent_28%),linear-gradient(180deg,_#f8fffd_0%,_#ffffff_34%,_#f8fafc_100%)] text-slate-900"
      data-testid="booking-root"
    >
      <Nav email={email} />

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <section className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-start">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
              Booking
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
              Reserve with more clarity from the very first step.
            </h1>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-slate-600">
              Start a booking request, keep your tenant notes in one place, and
              follow the reservation status without bouncing between tools.
            </p>
            <div className="mt-8 flex flex-wrap gap-3 text-sm">
              <Link
                href="/listings"
                className="rounded-full bg-teal-700 px-5 py-3 font-semibold text-white shadow-lg shadow-teal-700/20 transition hover:bg-teal-600"
              >
                Browse listings
              </Link>
              <Link
                href="/dashboard"
                className="rounded-full border border-slate-300 bg-white px-5 py-3 font-medium text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
              >
                Open dashboard
              </Link>
            </div>
          </div>

          <aside className="rounded-[2rem] border border-slate-200/80 bg-white/90 p-6 shadow-[0_20px_60px_-28px_rgba(15,23,42,0.35)] backdrop-blur">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
              Flow
            </p>
            <div className="mt-5 space-y-4">
              {[
                {
                  step: "1",
                  title: "Start a request",
                  body: "Pick dates, attach the listing ID, and keep pricing context with the booking.",
                },
                {
                  step: "2",
                  title: "Capture tenant notes",
                  body: "Store move-in requests and context directly on the booking instead of losing them in chat.",
                },
                {
                  step: "3",
                  title: "Track the outcome",
                  body: "See whether the reservation is still active, confirmed, or cancelled before taking the next step.",
                },
              ].map((item) => (
                <div
                  key={item.step}
                  className="rounded-[1.4rem] border border-slate-200 bg-slate-50/80 p-4"
                >
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-teal-700 text-sm font-semibold text-white">
                      {item.step}
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-slate-900">
                        {item.title}
                      </h2>
                      <p className="mt-1 text-sm leading-6 text-slate-600">
                        {item.body}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </aside>
        </section>

        <div className="mt-10 space-y-4">
          <FeedbackBanner message={message} error={error} />
        </div>

        <section className="mt-10 grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
                  New request
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                  Start a booking
                </h2>
              </div>
              <p className="text-sm text-slate-500">
                Create the booking first, then manage it below without leaving
                the page.
              </p>
            </div>

            <form
              data-testid="booking-create-form"
              onSubmit={handleCreateBooking}
              className="mt-8 space-y-5"
            >
              <div className="grid gap-5 md:grid-cols-2">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Listing ID
                  </span>
                  <input
                    required
                    value={listingId}
                    onChange={(event) => setListingId(event.target.value)}
                    placeholder="UUID from a listing"
                    className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Landlord ID
                  </span>
                  <input
                    value={landlordId}
                    onChange={(event) => setLandlordId(event.target.value)}
                    placeholder="Optional landlord UUID"
                    className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
                  />
                </label>
              </div>

              <div className="grid gap-5 md:grid-cols-3">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Start date
                  </span>
                  <input
                    required
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    End date
                  </span>
                  <input
                    required
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
                  />
                </label>

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Price snapshot
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={priceUsd}
                    onChange={(event) => setPriceUsd(event.target.value)}
                    placeholder="1500"
                    className="mt-2 w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
                  />
                </label>
              </div>

              <label className="block">
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Tenant notes
                </span>
                <textarea
                  value={tenantNotesDraft}
                  onChange={(event) => setTenantNotesDraft(event.target.value)}
                  rows={5}
                  placeholder="Move-in timing, accessibility needs, roommate context, or anything else you want attached to this booking."
                  className="mt-2 w-full rounded-[1.5rem] border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
                />
              </label>

              <div className="rounded-[1.5rem] border border-teal-100 bg-teal-50/60 px-4 py-4 text-sm text-teal-900">
                Creating a booking does not confirm it. Once the request is
                created, you can fetch it by ID, revise notes, confirm, or
                cancel from the management panel.
              </div>

              <button
                type="submit"
                disabled={busyAction !== null}
                className="inline-flex rounded-full bg-teal-700 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-teal-700/20 transition hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === "create" ? "Creating booking…" : "Create booking"}
              </button>
            </form>
          </div>

          <div className="space-y-6">
            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
                Current snapshot
              </p>
              {activeBooking ? (
                <>
                  <div className="mt-4 flex items-start justify-between gap-4">
                    <div>
                      <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                        {listingPreview?.title ?? "Selected booking"}
                      </h2>
                      <p className="mt-2 break-all text-sm text-slate-500">
                        Booking ID {activeBooking.id}
                      </p>
                    </div>
                    <span
                      className={`rounded-full border px-3 py-1 text-sm font-semibold capitalize ${statusTone(activeBooking.status)}`}
                    >
                      {humanizeStatus(activeBooking.status)}
                    </span>
                  </div>

                  <dl className="mt-6 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-[1.4rem] bg-slate-50 p-4">
                      <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Stay
                      </dt>
                      <dd className="mt-2 text-sm font-medium text-slate-900">
                        {formatDateLabel(activeBooking.startDate)} to{" "}
                        {formatDateLabel(activeBooking.endDate)}
                      </dd>
                    </div>
                    <div className="rounded-[1.4rem] bg-slate-50 p-4">
                      <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Price snapshot
                      </dt>
                      <dd className="mt-2 text-sm font-medium text-slate-900">
                        {formatMoney(
                          activeBooking.priceCentsSnapshot,
                          activeBooking.currencyCode || "USD",
                        )}
                      </dd>
                    </div>
                    <div className="rounded-[1.4rem] bg-slate-50 p-4">
                      <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Created
                      </dt>
                      <dd className="mt-2 text-sm font-medium text-slate-900">
                        {formatDateTimeLabel(activeBooking.createdAt)}
                      </dd>
                    </div>
                    <div className="rounded-[1.4rem] bg-slate-50 p-4">
                      <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Last change
                      </dt>
                      <dd className="mt-2 text-sm font-medium text-slate-900">
                        {formatDateTimeLabel(activeBooking.updatedAt)}
                      </dd>
                    </div>
                  </dl>

                  {listingPreview ? (
                    <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                        Listing context
                      </p>
                      <p className="mt-2 text-base font-semibold text-slate-900">
                        {listingPreview.title}
                      </p>
                      <p className="mt-1 text-sm text-slate-600">
                        {listingPreview.description?.trim() ||
                          "No listing description was provided."}
                      </p>
                    </div>
                  ) : listingPreviewError ? (
                    <div className="mt-6 rounded-[1.5rem] border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800">
                      {listingPreviewError}
                    </div>
                  ) : (
                    <div className="mt-6 rounded-[1.5rem] border border-slate-200 bg-slate-50 px-4 py-4 text-sm text-slate-500">
                      Loading listing context…
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-4 rounded-[1.5rem] border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-sm text-slate-500">
                  Create a booking or load one by ID to see its full status and
                  details here.
                </div>
              )}
            </section>

            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
                Step status
              </p>
              <div className="mt-5 space-y-3">
                {[
                  {
                    label: "Request created",
                    done: activeBooking != null,
                  },
                  {
                    label: "Tenant notes attached",
                    done: Boolean(activeBooking?.tenantNotes?.trim()),
                  },
                  {
                    label: "Booking confirmed",
                    done: activeBooking?.status === "confirmed",
                  },
                ].map((step) => (
                  <div
                    key={step.label}
                    className="flex items-center justify-between rounded-[1.2rem] border border-slate-200 px-4 py-3"
                  >
                    <span className="text-sm font-medium text-slate-700">
                      {step.label}
                    </span>
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        step.done
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {step.done ? "Done" : "Pending"}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </section>

        <section className="mt-10 rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
                Manage booking
              </p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                Review or update an existing booking
              </h2>
            </div>
            <p className="text-sm text-slate-500">
              Use a booking ID from a previous request if you want to reload it.
            </p>
          </div>

          <form
            onSubmit={handleLookupBooking}
            className="mt-8 flex flex-col gap-3 sm:flex-row"
          >
            <input
              value={bookingLookupId}
              onChange={(event) => setBookingLookupId(event.target.value)}
              placeholder="Paste booking UUID"
              className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-100"
            />
            <button
              type="submit"
              disabled={busyAction !== null || !bookingLookupId.trim()}
              className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busyAction === "lookup" ? "Loading…" : "Load booking"}
            </button>
          </form>

          <div className="mt-8 grid gap-8 xl:grid-cols-[1fr_0.95fr]">
            <form onSubmit={handleSaveNotes} className="rounded-[1.75rem] bg-slate-50 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">
                    Tenant notes
                  </h3>
                  <p className="mt-1 text-sm text-slate-600">
                    Keep move-in details and booking context attached to the reservation.
                  </p>
                </div>
                {notesLocked ? (
                  <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">
                    Locked
                  </span>
                ) : null}
              </div>

              <textarea
                value={tenantNotesDraft}
                onChange={(event) => setTenantNotesDraft(event.target.value)}
                rows={7}
                disabled={!activeBooking || notesLocked}
                placeholder="Notes will appear here once a booking is loaded."
                className="mt-5 w-full rounded-[1.4rem] border border-slate-300 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-teal-500 focus:ring-4 focus:ring-teal-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
              />

              <button
                type="submit"
                disabled={!activeBooking || notesLocked || busyAction !== null}
                className="mt-4 rounded-full bg-teal-700 px-5 py-3 text-sm font-semibold text-white transition hover:bg-teal-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === "notes" ? "Saving notes…" : "Save notes"}
              </button>
            </form>

            <div className="rounded-[1.75rem] bg-slate-50 p-5">
              <h3 className="text-lg font-semibold text-slate-900">
                Booking actions
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Actions are enabled only when the current booking status allows them.
              </p>

              <div className="mt-5 grid gap-4 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => void handleConfirmBooking()}
                  disabled={!activeBooking || !canConfirm || busyAction !== null}
                  className="rounded-[1.4rem] bg-emerald-600 px-5 py-4 text-left text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  <span className="block">Confirm booking</span>
                  <span className="mt-1 block text-xs font-medium text-emerald-50/90">
                    Best when the reservation details are final.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleCancelBooking()}
                  disabled={!activeBooking || !canCancel || busyAction !== null}
                  className="rounded-[1.4rem] bg-white px-5 py-4 text-left text-sm font-semibold text-red-700 shadow-sm ring-1 ring-red-200 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:text-red-300 disabled:ring-red-100"
                >
                  <span className="block">Cancel booking</span>
                  <span className="mt-1 block text-xs font-medium text-red-600/80">
                    Use this when the reservation should no longer continue.
                  </span>
                </button>
              </div>

              <div className="mt-5 rounded-[1.4rem] border border-slate-200 bg-white px-4 py-4 text-sm text-slate-600">
                {activeBooking ? (
                  <>
                    Current status:{" "}
                    <span className="font-semibold capitalize text-slate-900">
                      {humanizeStatus(activeBooking.status)}
                    </span>
                    . Confirmed at{" "}
                    <span className="font-medium text-slate-900">
                      {formatDateTimeLabel(activeBooking.confirmedAt)}
                    </span>
                    . Cancelled at{" "}
                    <span className="font-medium text-slate-900">
                      {formatDateTimeLabel(activeBooking.cancelledAt)}
                    </span>
                    .
                  </>
                ) : (
                  "Load a booking first to access actions and status history."
                )}
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
