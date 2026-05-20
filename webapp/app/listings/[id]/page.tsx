"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Nav } from "@/components/Nav";
import { deriveBookingCalendarViewport } from "@/lib/booking-calendar";
import {
  analyzeListingFeel,
  createBookingDateRange,
  getListingAvailability,
  getListing,
  getListingMeta,
  getReputation,
  watchlistAdd,
  watchlistList,
  watchlistRemove,
  type ListingJson,
} from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { formatPublicHostLabel, prettyListingDescription, prettyListingTitle } from "@/lib/listing-display";
import { normalizeMediaUrl } from "@/lib/media-url";

function userIdFromJwt(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
    return String(json.user_id || json.sub || "") || null;
  } catch {
    return null;
  }
}

function displayPricePerMonth(item: ListingJson): number {
  const cents = Number(item.price_cents || 0);
  if (Number.isFinite(cents) && cents > 0) return Math.round(cents / 100);
  const fallback = Number((item as ListingJson & { price?: number; price_usd_monthly?: number }).price ?? (item as ListingJson & { price_usd_monthly?: number }).price_usd_monthly ?? 0);
  return Number.isFinite(fallback) && fallback > 0 ? Math.round(fallback) : 0;
}

function amenityLabel(slug: string): string {
  const k = String(slug || "").toLowerCase();
  if (k === "in_unit_laundry") return "Laundry";
  if (k === "pet_friendly") return "Pet friendly";
  return k
    .split(/[_-]+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function dateRangeDays(start: string, end: string): number {
  const a = new Date(`${start}T00:00:00.000Z`).getTime();
  const b = new Date(`${end}T00:00:00.000Z`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round((b - a) / 86400000);
}

export default function ListingDetailPage() {
  const params = useParams<{ id: string }>();
  const listingId = String(params?.id || "");
  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [item, setItem] = useState<ListingJson | null>(null);
  const [analysis, setAnalysis] = useState<string>("");
  const [insightBusy, setInsightBusy] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [activeBookingCount, setActiveBookingCount] = useState<number>(0);
  const [bookingStartDate, setBookingStartDate] = useState<string>("");
  const [bookingEndDate, setBookingEndDate] = useState<string>("");
  const [showBookingConfirm, setShowBookingConfirm] = useState(false);
  const [availabilityConflicts, setAvailabilityConflicts] = useState<
    Array<{ startDate: string; endDate: string; status: string }>
  >([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [calendarBlockedRanges, setCalendarBlockedRanges] = useState<
    Array<{ startDate: string; endDate: string; status: string }>
  >([]);
  const [saved, setSaved] = useState(false);
  const [calendarMonthOffset, setCalendarMonthOffset] = useState(0);
  const [hostRep, setHostRep] = useState<{ avg: number | null; count: number } | null>(null);
  const [galleryIndex, setGalleryIndex] = useState(0);

  const renterId = useMemo(() => userIdFromJwt(token), [token]);

  const gallerySlides = useMemo(() => {
    if (!item) return [] as Array<{ url: string; kind: "image" | "video" }>;
    const mi = item.media_items;
    if (Array.isArray(mi) && mi.length) {
      return [...mi]
        .sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
        .map((m) => ({
          url: String(m.url_or_path || ""),
          kind: m.media_type === "video" ? ("video" as const) : ("image" as const),
        }));
    }
    return (item.images || []).map((url) => ({ url: String(url), kind: "image" as const }));
  }, [item]);

  useEffect(() => {
    setGalleryIndex(0);
  }, [listingId, item?.id]);

  useEffect(() => {
    setToken(getStoredToken());
    setEmail(getStoredEmail());
  }, []);

  useEffect(() => {
    if (!token || !listingId) return;
    let cancelled = false;
    watchlistList(token)
      .then((rows) => {
        if (cancelled) return;
        const ids = new Set(
          rows
            .map((row) => String((row as { listingId?: string; listing_id?: string }).listingId || (row as { listing_id?: string }).listing_id || ""))
            .filter(Boolean),
        );
        setSaved(ids.has(listingId));
      })
      .catch(() => {
        if (!cancelled) setSaved(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, listingId]);

  useEffect(() => {
    setAnalysis("");
    setInsightError(null);
    setInsightBusy(false);
  }, [listingId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [detail, meta] = await Promise.all([
          getListing(listingId),
          getListingMeta(listingId).catch(() => ({
            listingId,
            activeBookingCount: 0,
          })),
        ]);
        if (cancelled) return;
        setItem(detail);
        setActiveBookingCount(Number(meta.activeBookingCount || 0));
        setHostRep(null);
        const uid = String(detail.user_id || "").trim();
        if (uid) {
          getReputation(uid)
            .then((r) =>
              setHostRep({
                avg: r.avg_rating ?? null,
                count: r.review_count ?? 0,
              }),
            )
            .catch(() => setHostRep({ avg: null, count: 0 }));
        }
        setLoading(false);
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load listing.");
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listingId, token]);

  const loadListingInsight = useCallback(async () => {
    if (!item) return;
    setInsightBusy(true);
    setInsightError(null);
    try {
      const t0 = typeof performance !== "undefined" ? performance.now() : 0;
      const ai = await analyzeListingFeel(
        token,
        {
          title: item.title,
          description: item.description || "",
          price_cents: Number(item.price_cents || 0),
          audience: "renter",
          analysis_depth: "quick",
          listing_id: item.id,
        },
        { timeoutMs: 135_000 },
      );
      const t1 = typeof performance !== "undefined" ? performance.now() : 0;
      if (typeof performance !== "undefined" && ai.listing_feel_timing) {
        console.info("[listing-feel] timing", {
          client_roundtrip_ms: Math.round(t1 - t0),
          ...ai.listing_feel_timing,
        });
      }
      const err = (ai.error || "").trim();
      const text = String(ai.analysis_text || "").trim();
      if (err && !text) setInsightError(err);
      else {
        setInsightError(null);
        setAnalysis(text);
      }
    } catch (e: unknown) {
      setInsightError(e instanceof Error ? e.message : "Insight request failed.");
    } finally {
      setInsightBusy(false);
    }
  }, [item, token]);

  useEffect(() => {
    if (!item) return;
    const start = toYmd(new Date());
    const end = toYmd(addDays(new Date(), 180));
    getListingAvailability(item.id, { startDate: start, endDate: end })
      .then((out) => setCalendarBlockedRanges(out.ranges))
      .catch(() => setCalendarBlockedRanges([]));
  }, [item]);

  useEffect(() => {
    setCalendarMonthOffset(0);
  }, [bookingStartDate, listingId]);

  const blockedDateSet = useMemo(() => {
    const s = new Set<string>();
    for (const r of calendarBlockedRanges) {
      const a = new Date(`${r.startDate}T00:00:00.000Z`);
      const b = new Date(`${r.endDate}T00:00:00.000Z`);
      if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) continue;
      for (let cur = new Date(a); cur < b; cur = addDays(cur, 1)) s.add(toYmd(cur));
    }
    return s;
  }, [calendarBlockedRanges]);

  const availableFromYmd = useMemo(() => {
    const raw = String(item?.lease_terms?.effective_from || item?.listed_at || "").trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
  }, [item]);

  const calendarViewport = useMemo(
    () =>
      deriveBookingCalendarViewport({
        bookingStartDate,
        bookingEndDate,
        availableFromYmd,
        calendarMonthOffset,
        todayYmd: toYmd(new Date()),
      }),
    [availableFromYmd, bookingEndDate, bookingStartDate, calendarMonthOffset],
  );

  const displayMonths = useMemo(() => {
    return [calendarViewport.leftMonthStart, calendarViewport.rightMonthStart].map((m) => {
      const year = m.getUTCFullYear();
      const month = m.getUTCMonth();
      const firstWeekday = m.getUTCDay();
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      return { m, year, month, firstWeekday, daysInMonth };
    });
  }, [calendarViewport.leftMonthStart, calendarViewport.rightMonthStart]);

  const onBook = async () => {
    if (!token || !renterId || !item) {
      setError("Please log in before booking.");
      return;
    }
    if (!bookingStartDate || !bookingEndDate) {
      setError("Select both start and end dates.");
      return;
    }
    const start = new Date(`${bookingStartDate}T00:00:00.000Z`);
    const end = new Date(`${bookingEndDate}T00:00:00.000Z`);
    if (!(start.getTime() < end.getTime())) {
      setError("End date must be after start date.");
      return;
    }
    setBooking(true);
    setError(null);
    setNotice(null);
    try {
      await createBookingDateRange(token, {
        listingId: item.id,
        startDate: bookingStartDate,
        endDate: bookingEndDate,
        landlordId: item.user_id,
        priceCents: Number(item.price_cents || 0),
      });
      setNotice("Booking request sent. Landlord has been notified.");
      setActiveBookingCount((prev) => prev + 1);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Booking failed.");
    } finally {
      setBooking(false);
    }
  };

  const checkAvailability = async (): Promise<boolean> => {
    if (!item || !bookingStartDate || !bookingEndDate) return false;
    setCheckingAvailability(true);
    try {
      const out = await getListingAvailability(item.id, {
        startDate: bookingStartDate,
        endDate: bookingEndDate,
      });
      setAvailabilityConflicts(out.ranges);
      return out.available;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not verify date availability.");
      return false;
    } finally {
      setCheckingAvailability(false);
    }
  };

  const onReviewBooking = async () => {
    if (!bookingStartDate || !bookingEndDate) {
      setError("Select both start and end dates.");
      return;
    }
    const start = new Date(`${bookingStartDate}T00:00:00.000Z`);
    const end = new Date(`${bookingEndDate}T00:00:00.000Z`);
    if (!(start.getTime() < end.getTime())) {
      setError("End date must be after start date.");
      return;
    }
    setError(null);
    const ok = await checkAvailability();
    if (!ok) {
      setShowBookingConfirm(false);
      setError("Selected dates overlap with an existing booking.");
      return;
    }
    setShowBookingConfirm(true);
  };

  const onToggleSave = async () => {
    if (!token || !item) {
      setError("Please log in to save listings.");
      return;
    }
    try {
      const out = saved
        ? await watchlistRemove(token, item.id)
        : await watchlistAdd(token, item.id, "listing-detail");
      const wc = (out as { watch_count?: unknown }).watch_count;
      if (typeof wc === "number" && Number.isFinite(wc)) {
        setItem((prev) => (prev ? { ...prev, watch_count: Math.max(0, Math.floor(wc)) } : prev));
      }
      setSaved((v) => !v);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to update watchlist.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900">
        <Nav email={email} />
        <main className="mx-auto max-w-6xl px-4 py-8">
          <div className="mb-5 h-4 w-40 animate-pulse rounded bg-slate-200" />
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <div className="aspect-video animate-pulse rounded-2xl bg-slate-200" />
              <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="h-8 max-w-md animate-pulse rounded bg-slate-200" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-slate-100" />
                <div className="h-24 animate-pulse rounded bg-slate-100" />
              </div>
            </div>
            <aside className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="h-6 w-40 animate-pulse rounded bg-slate-200" />
              <div className="h-32 animate-pulse rounded bg-slate-100" />
              <div className="h-10 w-full animate-pulse rounded bg-slate-200" />
            </aside>
          </div>
          <p className="mt-6 text-center text-sm text-slate-500">Loading listing…</p>
        </main>
      </div>
    );
  }
  if (!item) {
    return (
      <div className="min-h-screen bg-slate-50 p-8 text-sm text-slate-700">
        {error || "We could not load this listing. It may be unavailable or the link may be incorrect."}
      </div>
    );
  }

  const slide = gallerySlides.length
    ? gallerySlides[Math.min(galleryIndex, gallerySlides.length - 1)]!
    : { url: "", kind: "image" as const };
  const image = normalizeMediaUrl(slide.url || item.images?.[0] || "");
  const pricePerMonth = displayPricePerMonth(item);
  const availableFrom = item.lease_terms?.effective_from || item.listed_at || null;
  const availableLabel = availableFrom ? new Date(availableFrom).toLocaleDateString() : "Now";
  const bedrooms = Number.isFinite(Number(item.bedrooms)) && Number(item.bedrooms) > 0 ? Number(item.bedrooms) : 1;
  const bathrooms = Number.isFinite(Number(item.bathrooms)) && Number(item.bathrooms) > 0 ? Number(item.bathrooms) : 1;
  const campusLat = 42.3868;
  const campusLng = -72.5301;
  let distMi: number | undefined;
  const la = item.latitude;
  const ln = item.longitude;
  if (Number.isFinite(Number(la)) && Number.isFinite(Number(ln))) {
    const dLat = ((Number(la) - campusLat) * Math.PI) / 180;
    const dLng = ((Number(ln) - campusLng) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((campusLat * Math.PI) / 180) *
        Math.cos((Number(la) * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    distMi = 3958.8 * c;
  }
  const locLine = String(item.location || item.display_location || "").trim();
  const bookDisabled = booking || checkingAvailability || Boolean(item?.listing_on_hold);
  const durationDays = dateRangeDays(bookingStartDate, bookingEndDate);
  const pickCalendarDay = (ymd: string) => {
    if (blockedDateSet.has(ymd)) return;
    if (!bookingStartDate || (bookingStartDate && bookingEndDate)) {
      setBookingStartDate(ymd);
      setBookingEndDate("");
      setShowBookingConfirm(false);
      return;
    }
    if (ymd <= bookingStartDate) {
      setBookingStartDate(ymd);
      setBookingEndDate("");
      setShowBookingConfirm(false);
      return;
    }
    setBookingEndDate(ymd);
    setShowBookingConfirm(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-5">
          <Link href="/listings" className="text-sm font-medium text-teal-700 hover:underline">← Back to listings</Link>
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:col-span-2">
            <div className="relative aspect-video bg-slate-100">
              {slide.kind === "video" && slide.url ? (
                <video
                  data-testid="listing-detail-cover-video"
                  key={slide.url}
                  src={normalizeMediaUrl(slide.url)}
                  className="h-full w-full object-contain"
                  controls
                  playsInline
                />
              ) : (
                <img
                  data-testid="listing-detail-cover-img"
                  src={image}
                  alt={item.title}
                  onError={(e) => {
                    e.currentTarget.src = "/placeholder.svg";
                  }}
                  className="h-full w-full object-cover"
                />
              )}
              {gallerySlides.length > 1 ? (
                <>
                  <div className="absolute inset-y-0 left-0 flex items-center">
                    <button
                      type="button"
                      className="m-2 rounded-full bg-white/90 px-3 py-2 text-sm font-semibold text-slate-800 shadow hover:bg-white"
                      aria-label="Previous photo"
                      onClick={() =>
                        setGalleryIndex((i) => (i - 1 + gallerySlides.length) % gallerySlides.length)
                      }
                    >
                      ←
                    </button>
                  </div>
                  <div className="absolute inset-y-0 right-0 flex items-center">
                    <button
                      type="button"
                      className="m-2 rounded-full bg-white/90 px-3 py-2 text-sm font-semibold text-slate-800 shadow hover:bg-white"
                      aria-label="Next photo"
                      onClick={() => setGalleryIndex((i) => (i + 1) % gallerySlides.length)}
                    >
                      →
                    </button>
                  </div>
                  <p className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-0.5 text-[11px] text-white">
                    {Math.min(galleryIndex, gallerySlides.length - 1) + 1} / {gallerySlides.length}
                  </p>
                </>
              ) : null}
            </div>
            <div className="space-y-4 p-6">
              <h1 className="text-2xl font-bold">{prettyListingTitle(item.title)}</h1>
              {item.listing_on_hold ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                  This listing is on a soft hold. It is hidden from search and new booking requests are blocked until
                  the hold ends.
                </div>
              ) : null}
              {String(item.pricing_mode || "").toLowerCase() === "obo" ? (
                <p className="text-sm font-medium text-violet-800">
                  <span className="mr-1 rounded bg-violet-100 px-2 py-0.5 text-xs font-semibold uppercase text-violet-900">
                    Best offer
                  </span>
                  Monthly rent is a starting point — message the host to discuss terms.
                </p>
              ) : null}
              <div
                data-testid="listing-landlord-display"
                className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 text-sm text-slate-700"
              >
                <p className="font-medium text-slate-900">
                  {formatPublicHostLabel(item.landlord_display) || "Host"}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {String(item.user_id || "").trim() ? (
                    <Link
                      href={`/users/${encodeURIComponent(String(item.user_id).trim())}`}
                      className="inline-flex flex-wrap items-center gap-x-1 text-teal-800 hover:underline"
                      title="Host profile, stars, and full review text"
                    >
                      {hostRep && hostRep.count > 0 && hostRep.avg != null && Number.isFinite(hostRep.avg) ? (
                        <>
                          <span className="text-amber-500" aria-hidden>
                            {"★".repeat(Math.min(5, Math.max(0, Math.round(hostRep.avg))))}
                            {"☆".repeat(Math.max(0, 5 - Math.min(5, Math.round(hostRep.avg))))}
                          </span>
                          <span className="ml-1 tabular-nums">{hostRep.avg.toFixed(1)}</span>
                          <span className="text-slate-500">
                            {" "}
                            · {hostRep.count} review{hostRep.count === 1 ? "" : "s"}
                          </span>
                        </>
                      ) : (
                        <span className="text-slate-500">No reviews yet — open feedback</span>
                      )}
                    </Link>
                  ) : hostRep && hostRep.count > 0 && hostRep.avg != null && Number.isFinite(hostRep.avg) ? (
                    <>
                      <span className="text-amber-500" aria-hidden>
                        {"★".repeat(Math.min(5, Math.max(0, Math.round(hostRep.avg))))}
                        {"☆".repeat(Math.max(0, 5 - Math.min(5, Math.round(hostRep.avg))))}
                      </span>
                      <span className="ml-1 tabular-nums">{hostRep.avg.toFixed(1)}</span>
                      <span className="text-slate-500">
                        {" "}
                        · {hostRep.count} review{hostRep.count === 1 ? "" : "s"}
                      </span>
                    </>
                  ) : (
                    <span className="text-slate-500">No reviews yet</span>
                  )}
                </p>
              </div>
              <p data-testid="listing-watch-count" className="text-sm text-slate-600">
                Watchers:{" "}
                <span className="font-medium text-slate-800">
                  {Math.max(0, Math.floor(Number(item.watch_count ?? 0)))}
                </span>
              </p>
              <p className="text-lg font-semibold text-slate-900">${pricePerMonth.toLocaleString()}/mo</p>
              <p className="text-sm text-slate-600">
                {item.residence_type ? (
                  <span className="capitalize">{String(item.residence_type).replace(/_/g, " ")} · </span>
                ) : null}
                {item.square_feet != null && Number.isFinite(Number(item.square_feet)) ? (
                  <span>{Math.floor(Number(item.square_feet)).toLocaleString()} sq ft · </span>
                ) : null}
                {bedrooms} Bed · {bathrooms} Bath
              </p>
              {locLine ? <p className="text-sm text-slate-600">{locLine}</p> : null}
              <p className="text-xs text-slate-500">
                {item.distance_miles_to_campus != null && Number.isFinite(Number(item.distance_miles_to_campus))
                  ? `${Number(item.distance_miles_to_campus).toFixed(1)} mi from campus`
                  : distMi !== undefined
                    ? `${distMi.toFixed(1)} mi from campus`
                    : "Distance unavailable"}
              </p>
              <p data-testid="listing-detail-description" className="text-sm text-slate-700 whitespace-pre-wrap">
                {prettyListingDescription(item.description || undefined)}
              </p>
              {item.amenities?.length ? (
                <div className="flex flex-wrap gap-2">
                  {item.amenities.map((a) => (
                    <span key={a} className="rounded-full border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700">{amenityLabel(a)}</span>
                  ))}
                </div>
              ) : null}
              <p className="text-sm">
                <Link
                  href={`/listings/${encodeURIComponent(listingId)}/revisions`}
                  className="font-medium text-teal-800 underline decoration-teal-600/40 underline-offset-2 hover:decoration-teal-700"
                  data-testid="listing-revision-history-link"
                >
                  View revision history
                </Link>
                <span className="text-slate-500"> — how this listing changed over time (public summary).</span>
              </p>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h2 className="mb-1 text-sm font-semibold text-slate-800">Listing feel (optional)</h2>
                <p className="mb-3 text-xs text-slate-600">
                  On-demand only so the page stays responsive. Uses a quick analysis pass; if analytics or the model is
                  slow, you still get the full listing above.
                </p>
                {!analysis && !insightBusy && !insightError ? (
                  <button
                    type="button"
                    onClick={() => void loadListingInsight()}
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
                  >
                    Generate insight
                  </button>
                ) : null}
                {insightBusy ? <p className="text-xs text-slate-600">Generating…</p> : null}
                {insightError ? (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <p>{insightError}</p>
                    <button
                      type="button"
                      className="mt-2 rounded border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-950 hover:bg-amber-100"
                      onClick={() => {
                        setInsightError(null);
                        setAnalysis("");
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                ) : null}
                {analysis ? <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-700">{analysis}</pre> : null}
              </div>
            </div>
          </section>
          <aside className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Request booking</h2>
            <p className="text-sm text-slate-600">Availability calendar · opens {availableLabel}</p>
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100"
                  onClick={() => setCalendarMonthOffset((o) => o - 1)}
                >
                  ← Prev
                </button>
                <span className="text-xs font-medium text-slate-600">
                  {bookingStartDate && bookingEndDate && calendarViewport.leftMonthKey !== calendarViewport.rightMonthKey
                    ? "Start + end month · tap range"
                    : "Two months · tap range"}
                </span>
                <button
                  type="button"
                  className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-800 hover:bg-slate-100"
                  onClick={() => setCalendarMonthOffset((o) => o + 1)}
                >
                  Next →
                </button>
              </div>
              {bookingStartDate && bookingEndDate ? (
                <div className="rounded-md border border-teal-200 bg-white px-3 py-2 text-xs text-slate-700">
                  <p>
                    Selected stay: <strong>{bookingStartDate}</strong> to <strong>{bookingEndDate}</strong>.
                  </p>
                  {calendarViewport.jumpToEndOffset != null && calendarViewport.leftMonthKey !== calendarViewport.rightMonthKey ? (
                    <div className="mt-2 text-slate-600">
                      Calendar is showing <strong>{calendarViewport.leftMonthKey}</strong> and{" "}
                      <strong>{calendarViewport.rightMonthKey}</strong> so long stays remain visible.
                    </div>
                  ) : null}
                </div>
              ) : null}
              {displayMonths.map(({ m, year, month, firstWeekday, daysInMonth }) => (
                <div key={`${year}-${month}`}>
                  <p className="mb-1 text-xs font-semibold text-slate-700">
                    {m.toLocaleString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}
                  </p>
                  <div className="grid grid-cols-7 gap-1 text-[10px] text-slate-500">
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                      <span key={d} className="text-center">{d}</span>
                    ))}
                  </div>
                  <div className="mt-1 grid grid-cols-7 gap-1">
                    {Array.from({ length: firstWeekday }).map((_, idx) => (
                      <span key={`pad-${idx}`} />
                    ))}
                    {Array.from({ length: daysInMonth }).map((_, idx) => {
                      const day = idx + 1;
                      const dt = new Date(Date.UTC(year, month, day));
                      const ymd = toYmd(dt);
                      const blocked = blockedDateSet.has(ymd);
                      const selected = ymd === bookingStartDate || ymd === bookingEndDate;
                      const inRange =
                        Boolean(bookingStartDate && bookingEndDate) &&
                        ymd > bookingStartDate &&
                        ymd < bookingEndDate;
                      return (
                        <button
                          key={ymd}
                          type="button"
                          onClick={() => pickCalendarDay(ymd)}
                          disabled={blocked}
                          className={`h-7 rounded text-xs ${
                            blocked
                              ? "cursor-not-allowed bg-rose-100 text-rose-500"
                              : selected
                                ? "bg-teal-700 text-white"
                                : inRange
                                  ? "bg-teal-100 text-teal-900"
                                  : "bg-white text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          {day}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <input
                  id="listing-book-start-date"
                  data-testid="listing-book-start-date"
                  type="date"
                  value={bookingStartDate}
                  onChange={(e) => setBookingStartDate(e.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
                <input
                  id="listing-book-end-date"
                  data-testid="listing-book-end-date"
                  type="date"
                  value={bookingEndDate}
                  onChange={(e) => setBookingEndDate(e.target.value)}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <p className="text-xs text-slate-600">
                {durationDays > 0 ? `Selected duration: ${durationDays} nights` : "Pick check-in and check-out dates"}
              </p>
            </div>
            <p data-testid="listing-active-bookings-count" className="text-xs text-slate-500">
              Active booking requests: {activeBookingCount}
            </p>
            <button
              type="button"
              data-testid="listing-detail-book-btn"
              disabled={bookDisabled}
              onClick={() => void onReviewBooking()}
              className="w-full rounded-md bg-teal-600 px-4 py-2 font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
            >
              {checkingAvailability ? "Checking dates..." : "Review booking"}
            </button>
            <p className="text-xs text-slate-600">
              Add this home to your watchlist from here or from any listing card on the browse page. Open{" "}
              <a href="/dashboard/watchlist" className="font-semibold text-blue-700 underline">
                Watchlist
              </a>{" "}
              anytime to review saved places.
            </p>
            <button
              type="button"
              data-testid="listing-detail-watchlist"
              onClick={() => void onToggleSave()}
              className={`w-full rounded-md px-4 py-2 text-sm font-semibold ${
                saved ? "bg-rose-100 text-rose-700" : "border border-slate-300 bg-white text-slate-800"
              }`}
            >
              {saved ? "Remove from watchlist" : "Add to watchlist"}
            </button>
            {showBookingConfirm ? (
              <div className="rounded-md border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
                <p>
                  Confirm booking from <strong>{bookingStartDate}</strong> to <strong>{bookingEndDate}</strong>
                  {durationDays > 0 ? <> ({durationDays} nights)</> : null}.
                </p>
                <button
                  type="button"
                  disabled={booking}
                  onClick={() => void onBook()}
                  className="mt-2 w-full rounded-md bg-teal-700 px-3 py-2 font-semibold text-white hover:bg-teal-600 disabled:opacity-50"
                >
                  {booking ? "Sending..." : "Confirm and send request"}
                </button>
              </div>
            ) : null}
            {availabilityConflicts.length > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                <p className="mb-1 font-semibold">Unavailable date ranges</p>
                <ul className="space-y-1">
                  {availabilityConflicts.slice(0, 5).map((r) => (
                    <li key={`${r.startDate}-${r.endDate}-${r.status}`}>
                      {r.startDate} to {r.endDate} ({r.status})
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {notice ? (
              <p data-testid="listing-book-notice" className="text-sm text-emerald-700">
                {notice}
              </p>
            ) : null}
            {error ? <p className="text-sm text-red-700">{error}</p> : null}
          </aside>
        </div>
      </main>
    </div>
  );
}
