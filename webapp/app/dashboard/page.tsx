"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listMyBookings,
  listSearchHistory,
  postSearchHistory,
  watchlistAdd,
  watchlistList,
  watchlistRemove,
  getListing,
  searchListingsPage,
} from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { getSubFromJwt } from "@/lib/jwt-sub";
import { BookingListingInline } from "@/components/BookingListingInline";
import { Nav } from "@/components/Nav";
import type { BookingListingCard, TenantBookingSummary } from "@/lib/api";
import { GoogleMapEmbed } from "@/components/GoogleMapEmbed";
import { filterDashboardRecentBookings } from "@/lib/booking-mine-partition";
import {
  isIntegrationBookingNoise,
  prettyBookingTitle,
  prettyBookingStatus,
  prettyListingTitle,
} from "@/lib/listing-display";
import { resolveWatchlistListingId } from "@/lib/listing-id-parse";
import { formatHostCounterpartyLine, formatRenterCounterpartyLine } from "@/lib/user-display";

type SearchRow = {
  id?: string;
  query?: string | null;
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
  maxDistanceKm?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  createdAt?: string;
};

type WatchRow = {
  listingId?: string;
  addedAt?: string;
  source?: string | null;
};

export default function DashboardPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  const [query, setQuery] = useState("near campus");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [maxKm, setMaxKm] = useState("5");

  const [history, setHistory] = useState<SearchRow[]>([]);
  const [watchlist, setWatchlist] = useState<WatchRow[]>([]);
  const [watchTitles, setWatchTitles] = useState<Record<string, string>>({});
  const [watchQuery, setWatchQuery] = useState("");
  const [watchSuggestions, setWatchSuggestions] = useState<Array<{ id: string; title: string }>>([]);
  const [watchPickBusy, setWatchPickBusy] = useState(false);
  const [listingId, setListingId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recentBookings, setRecentBookings] = useState<
    Array<{
      booking_id: string;
      status: string;
      startDate: string;
      endDate: string;
      listing_title?: string | null;
      listing?: BookingListingCard | null;
      party?: string;
    }>
  >([]);
  /** Ignore stale responses when multiple refreshAll() calls overlap (initial load vs post-save). */
  const refreshGen = useRef(0);

  useEffect(() => {
    const t = getStoredToken();
    const em = getStoredEmail();
    if (!t) {
      // Hard navigation is more reliable than client router in Playwright / strict edge cases.
      if (typeof window !== "undefined" && window.location.pathname.startsWith("/dashboard")) {
        window.location.replace(`${window.location.origin}/login`);
        return;
      }
      void router.replace("/login");
      return;
    }
    setToken(t);
    setEmail(em);
    setReady(true);
  }, [router]);

  useEffect(() => {
    if (!token || watchQuery.trim().length < 2) {
      setWatchSuggestions([]);
      return;
    }
    const handle = setTimeout(() => {
      setWatchPickBusy(true);
      void searchListingsPage({ q: watchQuery.trim(), limit: 8 })
        .then((pg) => {
          setWatchSuggestions(
            (pg.data || [])
              .map((li) => ({
                id: String(li.id || ""),
                title: prettyListingTitle(li.title),
              }))
              .filter((x) => x.id),
          );
        })
        .catch(() => setWatchSuggestions([]))
        .finally(() => setWatchPickBusy(false));
    }, 350);
    return () => clearTimeout(handle);
  }, [watchQuery, token]);

  const refreshAll = useCallback(async () => {
    if (!token) return;
    const gen = ++refreshGen.current;
    setLoading(true);
    setErr(null);
    try {
      const [h, w] = await Promise.all([
        listSearchHistory(token, 50),
        watchlistList(token),
      ]);
      const b = await listMyBookings(token, { role: "tenant", view: "all" });
      if (gen !== refreshGen.current) return;
      setHistory(h as SearchRow[]);
      setWatchlist(w as WatchRow[]);
      const ids = (w as WatchRow[])
        .map((x) => String(x.listingId || "").trim())
        .filter(Boolean)
        .slice(0, 24);
      const titleMap: Record<string, string> = {};
      if (token && ids.length) {
        await Promise.all(
          ids.map(async (id) => {
            try {
              const li = await getListing(id, { token });
              if (gen !== refreshGen.current) return;
              titleMap[id] = prettyListingTitle(li.title);
            } catch {
              if (gen === refreshGen.current) titleMap[id] = "";
            }
          }),
        );
      }
      if (gen !== refreshGen.current) return;
      setWatchTitles(titleMap);
      const my = (getSubFromJwt(token) || "").trim().toLowerCase();
      const partyLine = (row: {
        tenant_id?: string;
        landlord_id?: string;
        renter_username?: string | null;
        renter_display_name?: string | null;
        renter_display?: string | null;
        tenant_email?: string | null;
        landlord_display?: string | null;
        landlord_email?: string | null;
        listing?: { landlord_display?: string | null };
      }): string => {
        const tid = String(row.tenant_id || "").toLowerCase();
        const lid = String(row.landlord_id || "").toLowerCase();
        if (!my || (!tid && !lid)) return "";
        if (tid === my && lid) {
          return formatHostCounterpartyLine({
            landlord_display: row.landlord_display,
            listing_landlord_display: row.listing?.landlord_display,
            landlord_id: lid,
            landlord_email: row.landlord_email,
          });
        }
        if (lid === my && tid) {
          return formatRenterCounterpartyLine({
            renter_username: (row as { renter_username?: string | null }).renter_username,
            renter_display_name: (row as { renter_display_name?: string | null }).renter_display_name,
            renter_display: row.renter_display,
            tenant_email: row.tenant_email,
            tenant_id: tid,
          });
        }
        return "";
      };
      setRecentBookings(
        filterDashboardRecentBookings(Array.isArray(b) ? b : [])
          .filter((row) => {
            const summary = row as TenantBookingSummary;
            const rawTitle = summary.listing?.title ?? summary.listing_title ?? null;
            return !isIntegrationBookingNoise(rawTitle);
          })
          .map((row) => {
            const summary = row as TenantBookingSummary;
            const rawTitle = summary.listing?.title ?? summary.listing_title ?? null;
            return {
              booking_id: String(summary.booking_id || ""),
              status: String(summary.status || ""),
              startDate: String(summary.startDate || ""),
              endDate: String(summary.endDate || ""),
              listing_title: prettyBookingTitle(rawTitle),
              listing: summary.listing ?? null,
              party: partyLine(summary),
            };
          })
          .filter((row) => row.booking_id),
      );
    } catch (e: unknown) {
      if (gen !== refreshGen.current) return;
      setErr(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      if (gen === refreshGen.current) setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (ready && token) void refreshAll();
  }, [ready, token, refreshAll]);

  async function onSaveSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setMsg(null);
    setErr(null);
    setLoading(true);
    try {
      await postSearchHistory(token, {
        query,
        minPriceCents: minPrice ? Math.round(Number(minPrice) * 100) : undefined,
        maxPriceCents: maxPrice ? Math.round(Number(maxPrice) * 100) : undefined,
        maxDistanceKm: maxKm ? Number(maxKm) : undefined,
      });
      setMsg("Search saved to history.");
      await refreshAll();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function onAddWatch(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const id = resolveWatchlistListingId(listingId || watchQuery, watchSuggestions);
    if (!id) {
      setErr(
        watchSuggestions.length > 1
          ? "Choose one of the title suggestions, or paste a listing URL/UUID."
          : "Paste a full listing URL, a listing UUID, or use a single title match.",
      );
      return;
    }
    setMsg(null);
    setErr(null);
    setLoading(true);
    try {
      await watchlistAdd(token, id, "webapp");
      setMsg("Listing added to watchlist.");
      setListingId("");
      setWatchQuery("");
      await refreshAll();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Add failed");
    } finally {
      setLoading(false);
    }
  }

  async function onRemoveListing(id: string) {
    if (!token) return;
    setErr(null);
    setLoading(true);
    try {
      const out = await watchlistRemove(token, id);
      const text =
        typeof out.message === "string" && out.message.trim().length > 0
          ? out.message.trim()
          : "Removed from watchlist.";
      setMsg(text.endsWith(".") ? text : `${text}.`);
      await refreshAll();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setLoading(false);
    }
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-sky-50 via-white to-emerald-50/50 text-slate-500">
        Loading…
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-emerald-50/50 text-slate-900"
      data-testid="dashboard-root"
    >
      <Nav email={email} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="font-serif text-3xl text-slate-900">Housing search</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Search preferences are stored as <strong className="text-slate-800">search history</strong> (booking-service).
          Listings you care about go to your <strong className="text-slate-800">watchlist</strong>. Browse and post
          on the{" "}
          <a href="/listings" className="font-medium text-teal-700 hover:underline">
            listings
          </a>{" "}
          page, track your{" "}
          <a href="/dashboard/bookings" className="font-medium text-teal-700 hover:underline">
            bookings
          </a>
          , use{" "}
          <a href="/dashboard/messages" className="font-medium text-teal-700 hover:underline">
            messages
          </a>{" "}
          with <strong className="text-slate-800">email/SMS logging</strong> in the same workspace, manage your{" "}
          <a href="/dashboard/watchlist" className="font-medium text-teal-700 hover:underline">
            watchlist
          </a>
          , review landlord notifications on the{" "}
          <a href="/dashboard/landlord" className="font-medium text-teal-700 hover:underline">
            landlord dashboard
          </a>
          , and trust tools on{" "}
          <a href="/trust" className="font-medium text-teal-700 hover:underline">
            trust &amp; safety
          </a>
          . Map preview uses Google Maps Embed when{" "}
          <code className="rounded bg-slate-200 px-1 text-xs text-slate-800">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> is set
          (same as listings).
        </p>

        <div className="mt-6 max-w-xl">
          <GoogleMapEmbed placeQuery="University of Massachusetts Amherst" height={180} />
        </div>

        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          <section className="rounded-xl border border-slate-200 bg-white/80 p-6 shadow-sm">
            <h2 className="text-lg font-medium text-slate-900">Save search</h2>
            <form data-testid="search-form" onSubmit={onSaveSearch} className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Query</label>
                <input
                  data-testid="search-query"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Min price (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    placeholder="900"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Max price (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    placeholder="2000"
                    className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Max distance (km)</label>
                <input
                  data-testid="search-max-km"
                  type="number"
                  step="0.1"
                  value={maxKm}
                  onChange={(e) => setMaxKm(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 shadow-sm"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                data-testid="search-submit"
                className="rounded-md bg-teal-600 px-4 py-2 font-medium text-white hover:bg-teal-500 disabled:opacity-50"
              >
                Save to history
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white/80 p-6 shadow-sm">
            <h2 className="text-lg font-medium text-slate-900">Watchlist</h2>
            <p className="mt-1 text-sm text-slate-600">
              Save from any{" "}
              <a href="/listings" className="font-medium text-teal-700 hover:underline">
                listing card
              </a>{" "}
              or detail page, paste a listing URL here, or pick from a quick title search.
            </p>
            <div className="mt-3 space-y-2">
              <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">
                Find by title (optional)
              </label>
              <input
                value={watchQuery}
                onChange={(e) => setWatchQuery(e.target.value)}
                placeholder="e.g. 2 room apt"
                className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
              />
              {watchPickBusy ? <p className="text-xs text-slate-500">Searching…</p> : null}
              {watchSuggestions.length > 0 ? (
                <ul className="max-h-40 overflow-y-auto rounded-md border border-slate-200 bg-white text-sm shadow-sm">
                  {watchSuggestions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-slate-50"
                        onClick={() => {
                          setListingId(s.id);
                          setWatchQuery(s.title);
                          setWatchSuggestions([]);
                        }}
                      >
                        <span className="truncate font-medium text-slate-800">{s.title}</span>
                        <span className="shrink-0 font-mono text-[10px] text-slate-500">{s.id.slice(0, 8)}…</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            <form data-testid="watchlist-form" onSubmit={onAddWatch} className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                data-testid="watchlist-listing-id"
                value={listingId}
                onChange={(e) => setListingId(e.target.value)}
                placeholder="https://.../listings/<id> or listing UUID"
                className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm"
              />
              <button
                type="submit"
                disabled={loading}
                data-testid="watchlist-add"
                className="rounded-md border border-teal-200 bg-teal-50 px-4 py-2 font-medium text-teal-900 hover:bg-teal-100 disabled:opacity-50"
              >
                Add
              </button>
            </form>
            <ul data-testid="watchlist-items" className="mt-6 space-y-2">
              {watchlist.length === 0 && <li className="text-sm text-slate-500">No items yet.</li>}
              {watchlist.map((w) => (
                <li
                  key={w.listingId}
                  className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/listings/${encodeURIComponent(String(w.listingId || ""))}`}
                      className="block truncate font-medium text-teal-800 hover:underline"
                    >
                      {watchTitles[String(w.listingId)] || "Saved listing"}
                    </Link>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-slate-500">{w.listingId}</span>
                  </div>
                  <button
                    type="button"
                    data-testid={`watchlist-remove-${w.listingId}`}
                    className="shrink-0 text-xs text-red-600 hover:underline"
                    onClick={() => w.listingId && onRemoveListing(w.listingId)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="mt-10 rounded-xl border border-slate-200 bg-white/80 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-medium text-slate-900">Search history</h2>
            <button
              type="button"
              onClick={() => refreshAll()}
              className="text-sm font-medium text-teal-700 hover:underline"
            >
              Refresh
            </button>
          </div>
          <div data-testid="search-history" className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-4">Query</th>
                  <th className="py-2 pr-4">Min $</th>
                  <th className="py-2 pr-4">Max $</th>
                  <th className="py-2 pr-4">Km</th>
                  <th className="py-2">When</th>
                </tr>
              </thead>
              <tbody>
                {history.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-4 text-slate-500">
                      No history yet — save a search above.
                    </td>
                  </tr>
                )}
                {history.map((row) => (
                  <tr key={row.id ?? `${row.query}-${row.createdAt}`} className="border-b border-slate-100">
                    <td className="py-2 pr-4">{row.query ?? "—"}</td>
                    <td className="py-2 pr-4">
                      {row.minPriceCents != null ? (row.minPriceCents / 100).toFixed(2) : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {row.maxPriceCents != null ? (row.maxPriceCents / 100).toFixed(2) : "—"}
                    </td>
                    <td className="py-2 pr-4">{row.maxDistanceKm ?? "—"}</td>
                    <td className="py-2 text-slate-500">
                      {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(() => {
            const withGeo = history.find(
              (r) => r.latitude != null && r.longitude != null && Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
            );
            if (!withGeo) return null;
            return (
              <div className="mt-6 max-w-lg">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                  Latest search with location
                </p>
                <GoogleMapEmbed latitude={withGeo.latitude} longitude={withGeo.longitude} height={200} zoom={13} />
              </div>
            );
          })()}
        </section>

        <section className="mt-10 rounded-xl border border-slate-200 bg-white/80 p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-medium text-slate-900">Recent bookings</h2>
            <a href="/dashboard/bookings" className="text-sm font-medium text-teal-700 hover:underline">
              View all
            </a>
          </div>
          {recentBookings.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No active bookings yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {recentBookings.map((b) => (
                <li key={b.booking_id} className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                  <Link href={`/dashboard/bookings/${b.booking_id}`} className="block hover:opacity-90">
                    <BookingListingInline
                      listing={b.listing}
                      fallbackTitle={b.listing_title || "Listing booking"}
                    />
                    <p className="mt-2 text-xs text-slate-600">
                      {b.startDate} to {b.endDate} · {prettyBookingStatus(b.status)}
                    </p>
                    {b.party ? <p className="mt-0.5 text-xs text-slate-700">{b.party}</p> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {msg && <p className="mt-6 text-sm font-medium text-emerald-700">{msg}</p>}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </main>
    </div>
  );
}
