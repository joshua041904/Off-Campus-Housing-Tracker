"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListingsGrid } from "@/components/listings/ListingsGrid";
import { FilterBar } from "@/components/listings/FilterBar";
import type { ListingFilters } from "@/components/listings/types";
import { Nav } from "@/components/Nav";
import {
  enrichListingsWithHostReputation,
  postSearchHistory,
  requestBooking,
  searchListingsPage,
  watchlistAdd,
  watchlistList,
  watchlistRemove,
  type ListingJson,
} from "@/lib/api";
import { CardGridSkeleton } from "@/components/ui/DashboardSkeleton";
import { getStoredEmail } from "@/lib/auth-storage";
import { classifyFetchFailure, userSafeSearchMessage } from "@/lib/och-fetch-errors";
import { ochPerfMark, ochPerfMeasure, logPerfDebug } from "@/lib/och-perf";
import { useLoadSequenceGuard } from "@/lib/och-load-guard";
import { useOchSession } from "@/lib/och-session";

const EBAY_PAGE_SIZES = new Set([24, 48, 72, 96, 120, 128, 240]);

function coercePageSize(raw: string): number {
  const n = Number(raw);
  return EBAY_PAGE_SIZES.has(n) ? n : 24;
}

function userIdFromJwt(token: string | null): string | null {
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
    const id = String(json.user_id || json.sub || "");
    return id || null;
  } catch {
    return null;
  }
}

export default function ListingsPage() {
  const { token } = useOchSession();
  const [email, setEmail] = useState<string | null>(null);
  const [items, setItems] = useState<ListingJson[]>([]);
  const [listingsLoading, setListingsLoading] = useState(false);
  const [listingsLoaded, setListingsLoaded] = useState(false);
  const [reputationLoading, setReputationLoading] = useState(false);
  const { beginLoad, isStale } = useLoadSequenceGuard();
  const [quickBookingId, setQuickBookingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const [totalPages, setTotalPages] = useState<number | null>(null);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [saveSearchAlert, setSaveSearchAlert] = useState(false);
  const [saveSearchBusy, setSaveSearchBusy] = useState(false);
  const [saveSearchMsg, setSaveSearchMsg] = useState<string | null>(null);
  const [filters, setFilters] = useState<ListingFilters>({
    q: "",
    minPrice: "",
    maxPrice: "",
    bedrooms: "",
    bathrooms: "",
    residenceType: "",
    minSqft: "",
    maxSqft: "",
    campusWithinMiles: "",
    city: "",
    neighborhood: "",
    amenities: [],
    availableFrom: "",
    occupancyStart: "",
    occupancyEnd: "",
    petFriendly: false,
    furnishedOnly: false,
    smokeFreeOnly: false,
    utilitiesIncluded: false,
    leaseMonthsMin: "",
    sort: "created_desc",
    pageSize: "24",
    placeLabel: "",
    searchLat: null,
    searchLng: null,
    radiusMiles: "",
  });

  const renterId = useMemo(() => userIdFromJwt(token), [token]);
  const pageSizeNum = useMemo(() => coercePageSize(filters.pageSize), [filters.pageSize]);
  const firstSearchRef = useRef(true);

  useEffect(() => {
    setEmail(getStoredEmail());
    const sp = new URLSearchParams(window.location.search);
    setFilters((prev) => ({
      ...prev,
      q: sp.get("q") ?? prev.q,
      minPrice: sp.get("minPrice") ?? prev.minPrice,
      maxPrice: sp.get("maxPrice") ?? prev.maxPrice,
      bedrooms: sp.get("bedrooms") ?? prev.bedrooms,
      bathrooms: sp.get("bathrooms") ?? prev.bathrooms,
      occupancyStart: sp.get("available_start") ?? sp.get("occupancy_start") ?? prev.occupancyStart,
      occupancyEnd: sp.get("available_end") ?? sp.get("occupancy_end") ?? prev.occupancyEnd,
      leaseMonthsMin: sp.get("min_lease_months") ?? prev.leaseMonthsMin,
      petFriendly: sp.get("pet_friendly") === "1" || sp.get("pet_friendly") === "true",
      furnishedOnly: sp.get("furnished") === "1" || sp.get("furnished") === "true",
      smokeFreeOnly: sp.get("smoke_free") === "1" || sp.get("smoke_free") === "true",
      utilitiesIncluded: sp.get("utilities_included") === "1" || sp.get("utilities_included") === "true",
      residenceType: sp.get("residence_type") ?? prev.residenceType,
      minSqft: sp.get("min_sqft") ?? prev.minSqft,
      maxSqft: sp.get("max_sqft") ?? prev.maxSqft,
      campusWithinMiles: sp.get("campus_within_miles") ?? prev.campusWithinMiles,
      city: sp.get("city") ?? prev.city,
      neighborhood: sp.get("neighborhood") ?? prev.neighborhood,
      sort: sp.get("sort") ?? prev.sort,
      pageSize: sp.get("pageSize") ?? prev.pageSize,
      radiusMiles: sp.get("radius_miles") ?? prev.radiusMiles,
      placeLabel: sp.get("place") ?? prev.placeLabel,
    }));
  }, []);

  const loadSearchPage = useCallback(
    async (pageNum: number) => {
      const seq = beginLoad();
      setListingsLoading(true);
      setError(null);
      ochPerfMark("och:listings:start");
      try {
        const radiusNum = filters.radiusMiles ? Number(filters.radiusMiles) : NaN;
        const hasCenter =
          filters.searchLat != null &&
          filters.searchLng != null &&
          Number.isFinite(filters.searchLat) &&
          Number.isFinite(filters.searchLng);
        const campusCap = filters.campusWithinMiles ? Number(filters.campusWithinMiles) : NaN;
        const amenitiesCsv = (() => {
          const base = [...filters.amenities];
          if (filters.utilitiesIncluded && !base.includes("utilities_included")) {
            base.push("utilities_included");
          }
          return base.length ? base.join(",") : undefined;
        })();
        const pageRaw = await searchListingsPage({
          q: filters.q.trim() || undefined,
          minPrice: filters.minPrice ? Math.round(Number(filters.minPrice) * 100) : undefined,
          maxPrice: filters.maxPrice ? Math.round(Number(filters.maxPrice) * 100) : undefined,
          bedrooms: filters.bedrooms ? Number(filters.bedrooms) : undefined,
          bathrooms: filters.bathrooms ? Number(filters.bathrooms) : undefined,
          residence_type: filters.residenceType || undefined,
          min_sqft: filters.minSqft ? Number(filters.minSqft) : undefined,
          max_sqft: filters.maxSqft ? Number(filters.maxSqft) : undefined,
          campus_within_miles:
            Number.isFinite(campusCap) && campusCap > 0 ? campusCap : undefined,
          city: filters.city.trim() || undefined,
          neighborhood: filters.neighborhood.trim() || undefined,
          pet_friendly: filters.petFriendly || undefined,
          furnished: filters.furnishedOnly || undefined,
          smoke_free: filters.smokeFreeOnly || undefined,
          min_lease_months: filters.leaseMonthsMin ? Number(filters.leaseMonthsMin) : undefined,
          amenities: amenitiesCsv,
          occupancy_start: filters.occupancyStart || undefined,
          occupancy_end: filters.occupancyEnd || undefined,
          sort: filters.sort,
          limit: pageSizeNum,
          pageSize: pageSizeNum,
          page: pageNum,
          search_lat: hasCenter && Number.isFinite(radiusNum) && radiusNum > 0 ? filters.searchLat! : undefined,
          search_lng: hasCenter && Number.isFinite(radiusNum) && radiusNum > 0 ? filters.searchLng! : undefined,
          radius_miles: hasCenter && Number.isFinite(radiusNum) && radiusNum > 0 ? radiusNum : undefined,
        });
        if (isStale(seq)) return;
        setItems(pageRaw.data);
        ochPerfMark("och:listings:base-cards-rendered");
        ochPerfMeasure("och:listings:base", "och:listings:request-start", "och:listings:base-cards-rendered");
        setCurrentPage(pageNum);
        const tc = pageRaw.totalCount ?? pageRaw.totalApprox ?? null;
        setTotalCount(tc);
        const tp =
          pageRaw.totalPages ??
          (tc != null && pageSizeNum > 0 ? Math.max(1, Math.ceil(tc / pageSizeNum)) : null);
        setTotalPages(tp);
        setReputationLoading(true);
        void enrichListingsWithHostReputation(pageRaw.data)
          .then((enriched) => {
            if (isStale(seq)) return;
            setItems(enriched);
          })
          .finally(() => {
            if (!isStale(seq)) {
              setReputationLoading(false);
              ochPerfMark("och:listings:enrichment-complete");
              ochPerfMeasure(
                "och:listings:enrichment",
                "och:listings:base-cards-rendered",
                "och:listings:enrichment-complete",
              );
              logPerfDebug("listings:enrichment-done", { count: pageRaw.data.length });
            }
          });
      } catch (e: unknown) {
        if (isStale(seq)) return;
        setError(userSafeSearchMessage(classifyFetchFailure(e)));
        setItems([]);
        setTotalCount(null);
        setTotalPages(null);
      } finally {
        setListingsLoading(false);
        if (!isStale(seq)) setListingsLoaded(true);
      }
    },
    [filters, pageSizeNum, beginLoad, isStale],
  );

  useEffect(() => {
    const t = setTimeout(() => {
      setCurrentPage(1);
      void loadSearchPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [filters, pageSizeNum, loadSearchPage]);

  useEffect(() => {
    if (!token) {
      setSavedIds(new Set());
      return;
    }
    let cancelled = false;
    watchlistList(token)
      .then((rows) => {
        if (cancelled) return;
        const next = new Set(
          rows
            .map((row) => String((row as { listingId?: string; listing_id?: string }).listingId || (row as { listing_id?: string }).listing_id || ""))
            .filter(Boolean),
        );
        setSavedIds(next);
      })
      .catch(() => {
        if (!cancelled) setSavedIds(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    const sp = new URLSearchParams();
    if (filters.q.trim()) sp.set("q", filters.q.trim());
    if (filters.minPrice) sp.set("minPrice", filters.minPrice);
    if (filters.maxPrice) sp.set("maxPrice", filters.maxPrice);
    if (filters.bedrooms) sp.set("bedrooms", filters.bedrooms);
    if (filters.bathrooms) sp.set("bathrooms", filters.bathrooms);
    if (filters.occupancyStart) sp.set("available_start", filters.occupancyStart);
    if (filters.occupancyEnd) sp.set("available_end", filters.occupancyEnd);
    if (filters.leaseMonthsMin) sp.set("min_lease_months", filters.leaseMonthsMin);
    if (filters.petFriendly) sp.set("pet_friendly", "1");
    if (filters.furnishedOnly) sp.set("furnished", "1");
    if (filters.smokeFreeOnly) sp.set("smoke_free", "1");
    if (filters.utilitiesIncluded) sp.set("utilities_included", "1");
    if (filters.residenceType) sp.set("residence_type", filters.residenceType);
    if (filters.minSqft) sp.set("min_sqft", filters.minSqft);
    if (filters.maxSqft) sp.set("max_sqft", filters.maxSqft);
    if (filters.campusWithinMiles) sp.set("campus_within_miles", filters.campusWithinMiles);
    if (filters.city.trim()) sp.set("city", filters.city.trim());
    if (filters.neighborhood.trim()) sp.set("neighborhood", filters.neighborhood.trim());
    if (filters.sort) sp.set("sort", filters.sort);
    if (filters.pageSize) sp.set("pageSize", filters.pageSize);
    if (filters.radiusMiles) sp.set("radius_miles", filters.radiusMiles);
    if (filters.placeLabel) sp.set("place", filters.placeLabel);
    const next = `${window.location.pathname}${sp.toString() ? `?${sp}` : ""}`;
    window.history.replaceState(null, "", next);
  }, [filters]);

  const onQuickBook = useCallback(
    async (listing: ListingJson) => {
      if (!token || !renterId) {
        setError(null);
        setNotice("Open listing details to complete booking (auth temporarily optional on browse).");
        return;
      }
      setQuickBookingId(listing.id);
      setError(null);
      setNotice("Booking request sent (optimistic)...");
      try {
        const day = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
        await requestBooking(token, {
          listing_id: listing.id,
          renter_id: renterId,
          requested_date: day,
          message: `Quick booking request from listings card (${listing.title})`,
        });
        setNotice("Booking request sent. Landlord has been notified.");
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Booking failed.");
        setNotice(null);
      } finally {
        setQuickBookingId(null);
      }
    },
    [renterId, token],
  );

  const onToggleSave = useCallback(
    async (listing: ListingJson) => {
      if (!token) {
        setError("Please log in to save listings.");
        return;
      }
      const isSaved = savedIds.has(listing.id);
      try {
        if (isSaved) await watchlistRemove(token, listing.id);
        else await watchlistAdd(token, listing.id, "listings-grid");
        setSavedIds((prev) => {
          const next = new Set(prev);
          if (isSaved) next.delete(listing.id);
          else next.add(listing.id);
          return next;
        });
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to update watchlist.");
      }
    },
    [savedIds, token],
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-teal-50/30 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <header className="mb-5">
          <h1 className="font-serif text-3xl text-slate-900">Browse listings</h1>
          <p className="mt-2 text-sm text-slate-600">
            Card-based marketplace browse with server-side filtering, quick-book actions, and listing detail pages.
          </p>
          <p className="mt-2 rounded-md border border-amber-100 bg-amber-50/80 px-3 py-2 text-xs leading-relaxed text-amber-950">
            <strong>Availability:</strong> Search now supports occupancy date ranges. Set start/end dates to hide listings
            that are already booked for your requested window.
          </p>
        </header>

        <form data-testid="listings-search-form" onSubmit={(e) => e.preventDefault()}>
          <FilterBar
            filters={filters}
            onChange={setFilters}
            onSubmit={async () => {
              firstSearchRef.current = false;
              await loadSearchPage(1);
            }}
            disabled={listingsLoading}
          />
        </form>

        {token ? (
          <section className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="saved-search-panel">
            <h2 className="text-sm font-semibold text-slate-900">Saved search &amp; alerts</h2>
            <p className="mt-1 text-xs text-slate-600">
              Store this filter set and optionally get notified when a <strong>new</strong> active listing matches it (price, residence type, sq ft, and max distance from campus in miles).
            </p>
            <label className="mt-3 flex items-center gap-2 text-sm text-slate-800">
              <input type="checkbox" checked={saveSearchAlert} onChange={(e) => setSaveSearchAlert(e.target.checked)} />
              Email me / notify in-app when new listings match this search
            </label>
            <button
              type="button"
              disabled={saveSearchBusy}
              onClick={async () => {
                if (!token) return;
                setSaveSearchBusy(true);
                setSaveSearchMsg(null);
                setError(null);
                try {
                  const minC = filters.minPrice ? Math.round(Number(filters.minPrice) * 100) : undefined;
                  const maxC = filters.maxPrice ? Math.round(Number(filters.maxPrice) * 100) : undefined;
                  const milesRaw = filters.campusWithinMiles ? Number(filters.campusWithinMiles) : NaN;
                  const maxCampusMiles =
                    typeof milesRaw === "number" && Number.isFinite(milesRaw) && milesRaw > 0 ? milesRaw : undefined;
                  const filtersPayload: Record<string, unknown> = {};
                  if (filters.residenceType) filtersPayload.residence_types = [filters.residenceType];
                  if (filters.minSqft) filtersPayload.min_sqft = Number(filters.minSqft);
                  if (filters.maxSqft) filtersPayload.max_sqft = Number(filters.maxSqft);
                  if (filters.bedrooms) filtersPayload.min_bedrooms = Number(filters.bedrooms);
                  await postSearchHistory(token, {
                    query: filters.q.trim() || undefined,
                    minPriceCents: minC,
                    maxPriceCents: maxC,
                    maxCampusMiles,
                    alertOnMatch: saveSearchAlert,
                    filters: Object.keys(filtersPayload).length ? filtersPayload : undefined,
                  });
                  setSaveSearchMsg("Saved search stored. New matches can trigger notifications when alerts are on.");
                } catch (e: unknown) {
                  setError(e instanceof Error ? e.message : "Could not save search");
                } finally {
                  setSaveSearchBusy(false);
                }
              }}
              className="mt-3 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {saveSearchBusy ? "Saving…" : "Save current search"}
            </button>
            {saveSearchMsg ? <p className="mt-2 text-xs text-emerald-800">{saveSearchMsg}</p> : null}
          </section>
        ) : null}

        {notice ? <p data-testid="listing-created-banner" className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</p> : null}
        {error ? <p data-testid="listings-api-error" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

        <section data-testid="listings-results" aria-busy={listingsLoading} className="space-y-4">
          {totalCount != null ? (
            <p className="text-xs text-slate-500">
              {totalCount.toLocaleString()} result{totalCount === 1 ? "" : "s"}
              {totalPages != null ? ` · Page ${currentPage} of ${totalPages}` : ` · Page ${currentPage}`}
            </p>
          ) : null}
          {listingsLoading ? <CardGridSkeleton rows={6} data-testid="listings-grid-skeleton" /> : null}
          {!listingsLoading ? (
            <ListingsGrid
              items={items}
              listingsLoaded={listingsLoaded && !error}
              onQuickBook={onQuickBook}
              quickBookingId={quickBookingId}
              savedIds={savedIds}
              onToggleSave={onToggleSave}
            />
          ) : null}
          {reputationLoading ? (
            <p className="text-center text-xs text-slate-400" data-testid="listings-reputation-loading">
              Updating host ratings…
            </p>
          ) : null}
          <div className="flex flex-wrap items-center justify-center gap-3 py-4">
            <button
              type="button"
              onClick={() => {
                if (currentPage <= 1 || listingsLoading) return;
                void loadSearchPage(currentPage - 1);
              }}
              disabled={listingsLoading || currentPage <= 1}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              ← Previous
            </button>
            <button
              type="button"
              onClick={() => {
                if (listingsLoading) return;
                if (totalPages != null && currentPage >= totalPages) return;
                if (items.length < pageSizeNum) return;
                void loadSearchPage(currentPage + 1);
              }}
              disabled={
                listingsLoading ||
                (totalPages != null ? currentPage >= totalPages : items.length < pageSizeNum)
              }
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Next →
            </button>
          </div>
        </section>

      </main>
    </div>
  );
}
