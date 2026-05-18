"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Nav } from "@/components/Nav";
import { getListing, searchListings, watchlistAdd, watchlistList, watchlistRemove, type ListingJson } from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { parseListingIdFromUserInput, resolveWatchlistListingId } from "@/lib/listing-id-parse";
import { normalizeMediaUrl } from "@/lib/media-url";
import { prettyListingTitle } from "@/lib/listing-display";

type SavedItem = {
  listingId: string;
  listing: ListingJson | null;
};

export default function DashboardWatchlistPage() {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [items, setItems] = useState<SavedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [addInput, setAddInput] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [titleSuggestions, setTitleSuggestions] = useState<Array<{ id: string; title: string }>>([]);

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
    watchlistList(token)
      .then(async (rows) => {
        const ids = rows
          .map((row) => String((row as { listingId?: string; listing_id?: string }).listingId || (row as { listing_id?: string }).listing_id || ""))
          .filter(Boolean);
        const listings = await Promise.all(
          ids.map(async (id) => {
            try {
              const listing = await getListing(id);
              return { listingId: id, listing };
            } catch {
              return { listingId: id, listing: null };
            }
          }),
        );
        if (!cancelled) setItems(listings);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load watchlist");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || addInput.trim().length < 2) {
      setTitleSuggestions([]);
      return;
    }
    const direct = parseListingIdFromUserInput(addInput);
    if (direct) {
      setTitleSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void searchListings({ q: addInput.trim() })
        .then((rows) => {
          if (cancelled) return;
          setTitleSuggestions(
            rows.slice(0, 8).map((r) => ({
              id: String(r.id),
              title: prettyListingTitle(String(r.title || "")),
            })),
          );
        })
        .catch(() => {
          if (!cancelled) setTitleSuggestions([]);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [addInput, token]);

  async function addToWatchlist() {
    if (!token) return;
    setAddBusy(true);
    setError(null);
    try {
      const listingId = resolveWatchlistListingId(addInput, titleSuggestions);
      if (!listingId) {
        setError("Paste a listing URL, UUID, or pick a title from suggestions.");
        return;
      }
      await watchlistAdd(token, listingId, "webapp.watchlist.dashboard");
      setAddInput("");
      setTitleSuggestions([]);
      const listing = await getListing(listingId).catch(() => null);
      setItems((prev) => {
        if (prev.some((x) => x.listingId === listingId)) return prev;
        return [{ listingId, listing }, ...prev];
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add listing");
    } finally {
      setAddBusy(false);
    }
  }

  async function remove(id: string) {
    if (!token) return;
    setError(null);
    try {
      await watchlistRemove(token, id);
      setItems((prev) => prev.filter((x) => x.listingId !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to remove listing");
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-white to-emerald-50/40 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-6xl px-4 py-10">
        <h1 className="font-serif text-3xl text-slate-900">Saved listings</h1>
        <p className="mt-2 text-sm text-slate-600">
          Save from listing detail, paste a <strong>listing URL</strong>, enter a <strong>UUID</strong>, or search by
          title below.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3">
          <label className="min-w-[12rem] flex-1 text-sm">
            <span className="font-medium text-slate-700">Add listing</span>
            <input
              type="text"
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              placeholder="URL, UUID, or listing title…"
              className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            disabled={addBusy || !addInput.trim()}
            onClick={() => void addToWatchlist()}
            className="rounded-md bg-teal-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50"
          >
            {addBusy ? "Adding…" : "Add to watchlist"}
          </button>
        </div>
        {titleSuggestions.length > 0 ? (
          <ul className="mt-2 space-y-1 rounded-md border border-slate-200 bg-white p-2 text-sm">
            {titleSuggestions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="w-full rounded px-2 py-1 text-left hover:bg-teal-50"
                  onClick={() => {
                    setAddInput(s.title);
                    void (async () => {
                      if (!token) return;
                      setAddBusy(true);
                      try {
                        await watchlistAdd(token, s.id, "webapp.watchlist.dashboard");
                        const listing = await getListing(s.id).catch(() => null);
                        setItems((prev) =>
                          prev.some((x) => x.listingId === s.id)
                            ? prev
                            : [{ listingId: s.id, listing }, ...prev],
                        );
                        setAddInput("");
                        setTitleSuggestions([]);
                      } catch (e: unknown) {
                        setError(e instanceof Error ? e.message : "Failed to add");
                      } finally {
                        setAddBusy(false);
                      }
                    })();
                  }}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {loading ? <p className="mt-6 text-sm text-slate-600">Loading...</p> : null}
        {error ? <p className="mt-6 text-sm text-red-700">{error}</p> : null}
        {!loading && !error && items.length === 0 ? (
          <p className="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">
            No saved listings yet. Go to the marketplace, open a listing, and tap <strong>Save to watchlist</strong> (or use the save control on each card when you are logged in).
          </p>
        ) : null}
        <ul className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <li key={it.listingId} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <img
                src={normalizeMediaUrl(it.listing?.images?.[0] || it.listing?.primaryImageUrl || "")}
                alt={it.listing?.title || "Listing"}
                className="h-44 w-full object-cover"
              />
              <div className="space-y-2 p-3">
                <p className="font-medium text-slate-900">{it.listing?.title || "Listing unavailable"}</p>
                <p className="text-xs text-slate-600">
                  {it.listing ? `$${Math.round(Number(it.listing.price_cents || 0) / 100).toLocaleString()}/mo` : "Unavailable"}
                  {it.listing?.display_location || it.listing?.location
                    ? ` · ${String(it.listing.display_location || it.listing.location || "").trim()}`
                    : ""}
                  {it.listing?.status ? ` · ${String(it.listing.status).trim()}` : ""}
                </p>
                <p className="text-[11px] text-slate-500">{it.listingId}</p>
                <div className="flex gap-2">
                  <Link href={`/listings/${it.listingId}`} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50">
                    View
                  </Link>
                  <button
                    type="button"
                    onClick={() => void remove(it.listingId)}
                    className="rounded-md bg-rose-100 px-2 py-1 text-xs text-rose-700"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}

