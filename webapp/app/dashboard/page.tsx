"use client";

import { useCallback, useEffect, useState } from "react";
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

type SearchRow = {
  id?: string;
  query?: string | null;
  minPriceCents?: number | null;
  maxPriceCents?: number | null;
  maxDistanceKm?: number | null;
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

  useEffect(() => {
    const t = getStoredToken();
    const em = getStoredEmail();
    if (!t) {
      router.replace("/login");
      return;
    }
    setToken(t);
    setEmail(em);
    setReady(true);
  }, [router]);

  const refreshAll = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setErr(null);
    try {
      const [h, w] = await Promise.all([
        listSearchHistory(token, 50),
        watchlistList(token),
      ]);
      setHistory(h as SearchRow[]);
      setWatchlist(w as WatchRow[]);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to load data");
    } finally {
      setLoading(false);
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
      await watchlistRemove(token, id);
      setMsg("Removed from watchlist.");
      await refreshAll();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Remove failed");
    } finally {
      setLoading(false);
    }
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-stone-950 text-stone-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950 text-stone-100">
      <Nav email={email} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="font-serif text-3xl text-amber-50">Housing search</h1>
        <p className="mt-2 max-w-2xl text-sm text-stone-400">
          Search preferences are stored as <strong>search history</strong> (booking-service). Listings you care about go to
          your <strong>watchlist</strong> (UUIDs). Full listing search UI can plug into listings-service when available.
        </p>

        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          <section className="rounded-xl border border-stone-800 bg-stone-900/40 p-6">
            <h2 className="text-lg font-medium text-amber-100">Save search</h2>
            <form data-testid="search-form" onSubmit={onSaveSearch} className="mt-4 space-y-3">
              <div>
                <label className="text-xs uppercase tracking-wide text-stone-500">Query</label>
                <input
                  data-testid="search-query"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="mt-1 w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs uppercase tracking-wide text-stone-500">Min price (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={minPrice}
                    onChange={(e) => setMinPrice(e.target.value)}
                    placeholder="900"
                    className="mt-1 w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide text-stone-500">Max price (USD)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={maxPrice}
                    onChange={(e) => setMaxPrice(e.target.value)}
                    placeholder="2000"
                    className="mt-1 w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs uppercase tracking-wide text-stone-500">Max distance (km)</label>
                <input
                  data-testid="search-max-km"
                  type="number"
                  step="0.1"
                  value={maxKm}
                  onChange={(e) => setMaxKm(e.target.value)}
                  className="mt-1 w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                data-testid="search-submit"
                className="rounded-md bg-amber-600 px-4 py-2 font-medium text-stone-950 hover:bg-amber-500 disabled:opacity-50"
              >
                Save to history
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-stone-800 bg-stone-900/40 p-6">
            <h2 className="text-lg font-medium text-amber-100">Watchlist</h2>
            <p className="mt-1 text-sm text-stone-500">Add a listing UUID (from listings or seed data).</p>
            <form data-testid="watchlist-form" onSubmit={onAddWatch} className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                data-testid="watchlist-listing-id"
                value={listingId}
                onChange={(e) => setListingId(e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="flex-1 rounded-md border border-stone-700 bg-stone-950 px-3 py-2 font-mono text-sm"
              />
              <button
                type="submit"
                disabled={loading}
                data-testid="watchlist-add"
                className="rounded-md border border-amber-700/80 bg-amber-950/40 px-4 py-2 text-amber-100 hover:bg-amber-900/50 disabled:opacity-50"
              >
                Add
              </button>
            </form>
            <ul data-testid="watchlist-items" className="mt-6 space-y-2">
              {watchlist.length === 0 && <li className="text-sm text-stone-500">No items yet.</li>}
              {watchlist.map((w) => (
                <li
                  key={w.listingId}
                  className="flex items-center justify-between gap-2 rounded-md border border-stone-800 bg-stone-950/80 px-3 py-2 font-mono text-sm"
                >
                  <span className="truncate">{w.listingId}</span>
                  <button
                    type="button"
                    data-testid={`watchlist-remove-${w.listingId}`}
                    className="shrink-0 text-xs text-red-400 hover:underline"
                    onClick={() => w.listingId && onRemoveListing(w.listingId)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="mt-10 rounded-xl border border-stone-800 bg-stone-900/40 p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-medium text-amber-100">Search history</h2>
            <button
              type="button"
              onClick={() => refreshAll()}
              className="text-sm text-amber-400/90 hover:underline"
            >
              Refresh
            </button>
          </div>
          <div data-testid="search-history" className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-stone-800 text-stone-500">
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
                    <td colSpan={5} className="py-4 text-stone-500">
                      No history yet — save a search above.
                    </td>
                  </tr>
                )}
                {history.map((row) => (
                  <tr key={row.id ?? `${row.query}-${row.createdAt}`} className="border-b border-stone-800/80">
                    <td className="py-2 pr-4">{row.query ?? "—"}</td>
                    <td className="py-2 pr-4">
                      {row.minPriceCents != null ? (row.minPriceCents / 100).toFixed(2) : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      {row.maxPriceCents != null ? (row.maxPriceCents / 100).toFixed(2) : "—"}
                    </td>
                    <td className="py-2 pr-4">{row.maxDistanceKm ?? "—"}</td>
                    <td className="py-2 text-stone-500">
                      {row.createdAt ? new Date(row.createdAt).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {msg && <p className="mt-6 text-sm text-emerald-400">{msg}</p>}
        {err && <p className="mt-2 text-sm text-red-400">{err}</p>}
      </main>
    </div>
  );
}
