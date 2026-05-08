"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  listSearchHistory,
  postSearchHistory,
  watchlistAdd,
  watchlistList,
  watchlistRemove,
} from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { Nav } from "@/components/Nav";
import { GoogleMapEmbed } from "@/components/GoogleMapEmbed";

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
  const [listingId, setListingId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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
      if (gen !== refreshGen.current) return;
      setHistory(h as SearchRow[]);
      setWatchlist(w as WatchRow[]);
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
    if (!token || !listingId.trim()) return;
    setMsg(null);
    setErr(null);
    setLoading(true);
    try {
      await watchlistAdd(token, listingId.trim(), "webapp");
      setMsg("Listing added to watchlist.");
      setListingId("");
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
          Listings you care about go to your <strong className="text-slate-800">watchlist</strong> (UUIDs). Browse and post
          listings on the{" "}
          <a href="/listings" className="font-medium text-teal-700 hover:underline">
            listings
          </a>{" "}
          page; trust tools on{" "}
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
            <p className="mt-1 text-sm text-slate-600">Add a listing UUID (from listings or seed data).</p>
            <form data-testid="watchlist-form" onSubmit={onAddWatch} className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                data-testid="watchlist-listing-id"
                value={listingId}
                onChange={(e) => setListingId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 shadow-sm"
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
                  className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-800"
                >
                  <span className="truncate">{w.listingId}</span>
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

        {msg && <p className="mt-6 text-sm font-medium text-emerald-700">{msg}</p>}
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
      </main>
    </div>
  );
}
