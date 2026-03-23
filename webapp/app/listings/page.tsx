"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createListing, getListing, searchListings, type ListingJson } from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { Nav } from "@/components/Nav";
import { GoogleMapEmbed } from "@/components/GoogleMapEmbed";

export default function ListingsPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [smokeFree, setSmokeFree] = useState(false);
  const [petFriendly, setPetFriendly] = useState(false);
  const [items, setItems] = useState<ListingJson[]>([]);
  const [detail, setDetail] = useState<ListingJson | null>(null);
  const [detailId, setDetailId] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    setToken(getStoredToken());
    setEmail(getStoredEmail());
  }, []);

  const onSearch = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      setErr(null);
      setLoading(true);
      try {
        const minC = minPrice ? Math.round(Number(minPrice) * 100) : undefined;
        const maxC = maxPrice ? Math.round(Number(maxPrice) * 100) : undefined;
        const list = await searchListings({
          q: q.trim() || undefined,
          min_price: minC,
          max_price: maxC,
          smoke_free: smokeFree,
          pet_friendly: petFriendly,
        });
        setItems(list);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Search failed");
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [q, minPrice, maxPrice, smokeFree, petFriendly]
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setErr(null);
      try {
        const list = await searchListings({});
        if (!cancelled) setItems(list);
      } catch (e: unknown) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Could not load listings");
          setItems([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onLoadDetail(e: React.FormEvent) {
    e.preventDefault();
    if (!detailId.trim()) return;
    setErr(null);
    setLoading(true);
    try {
      setDetail(await getListing(detailId.trim()));
    } catch (e: unknown) {
      setDetail(null);
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setMsg(null);
    setErr(null);
    const cents = Math.round(Number(priceUsd) * 100);
    if (!title.trim() || !Number.isFinite(cents) || cents <= 0 || !effectiveFrom) {
      setErr("Title, positive price, and effective-from date required.");
      return;
    }
    setLoading(true);
    try {
      await createListing(token, {
        title: title.trim(),
        description: desc.trim(),
        price_cents: cents,
        effective_from: effectiveFrom,
        smoke_free: true,
        pet_friendly: false,
        amenities: [],
      });
      setMsg("Listing created.");
      setTitle("");
      setDesc("");
      setPriceUsd("");
      await onSearch();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Create failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-stone-950 via-stone-900 to-stone-950 text-stone-100">
      <Nav email={email} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="font-serif text-3xl text-amber-50">Browse listings</h1>
        <p className="mt-2 text-sm text-stone-400">
          Public search via gateway → listings-service.{" "}
          <Link href="/dashboard" className="text-amber-400 hover:underline">
            Dashboard
          </Link>{" "}
          for watchlist &amp; search history.
        </p>

        <form
          data-testid="listings-search-form"
          onSubmit={onSearch}
          className="mt-8 grid gap-4 rounded-xl border border-stone-800 bg-stone-900/40 p-6 md:grid-cols-2 lg:grid-cols-4"
        >
          <div className="md:col-span-2">
            <label className="text-xs uppercase tracking-wide text-stone-500">Keywords</label>
            <input
              data-testid="listings-search-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="mt-1 w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2"
              placeholder="studio, laundry…"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-stone-500">Min price (USD)</label>
            <input
              type="number"
              step="0.01"
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
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
              className="mt-1 w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={smokeFree} onChange={(e) => setSmokeFree(e.target.checked)} />
            Smoke-free
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={petFriendly} onChange={(e) => setPetFriendly(e.target.checked)} />
            Pet-friendly
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={loading}
              data-testid="listings-search-submit"
              className="rounded-md bg-amber-600 px-4 py-2 font-medium text-stone-950 hover:bg-amber-500 disabled:opacity-50"
            >
              Search
            </button>
          </div>
        </form>

        {/* min-height: avoid 0-height while loading; aria-busy lets e2e wait for initial fetch to finish. */}
        <div
          data-testid="listings-results"
          className="mt-8 min-h-[3rem] space-y-3"
          aria-busy={loading}
        >
          {items.length === 0 && !loading && <p className="text-sm text-stone-500">No listings match (or empty index).</p>}
          {items.map((row) => (
            <div
              key={row.id}
              className="rounded-lg border border-stone-800 bg-stone-900/50 px-4 py-3 text-sm"
            >
              <div className="font-medium text-amber-100">{row.title}</div>
              <div className="mt-1 text-stone-400">
                ${(row.price_cents / 100).toFixed(2)} ·{" "}
                <span className="font-mono text-xs text-stone-500">{row.id}</span>
              </div>
              {(row.latitude != null && row.longitude != null) && (
                <div className="mt-3 max-w-md">
                  <GoogleMapEmbed latitude={row.latitude} longitude={row.longitude} height={160} zoom={15} />
                </div>
              )}
            </div>
          ))}
        </div>

        <section className="mt-12 rounded-xl border border-stone-800 bg-stone-900/40 p-6">
          <h2 className="text-lg font-medium text-amber-100">Listing by ID</h2>
          <form onSubmit={onLoadDetail} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              value={detailId}
              onChange={(e) => setDetailId(e.target.value)}
              placeholder="listing UUID"
              className="flex-1 rounded-md border border-stone-700 bg-stone-950 px-3 py-2 font-mono text-sm"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-md border border-stone-600 px-4 py-2 text-stone-200 hover:bg-stone-800 disabled:opacity-50"
            >
              Load
            </button>
          </form>
          {detail && (
            <pre className="mt-4 overflow-x-auto rounded-md bg-stone-950 p-4 text-xs text-stone-300">
              {JSON.stringify(detail, null, 2)}
            </pre>
          )}
        </section>

        {token ? (
          <section className="mt-10 rounded-xl border border-stone-800 bg-stone-900/40 p-6">
            <h2 className="text-lg font-medium text-amber-100">Post a listing</h2>
            <form onSubmit={onCreate} className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="text-xs uppercase text-stone-500">Title</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs uppercase text-stone-500">Description</label>
                <textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2"
                />
              </div>
              <div>
                <label className="text-xs uppercase text-stone-500">Price (USD)</label>
                <input
                  type="number"
                  step="0.01"
                  value={priceUsd}
                  onChange={(e) => setPriceUsd(e.target.value)}
                  className="mt-1 w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="text-xs uppercase text-stone-500">Effective from</label>
                <input
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="mt-1 w-full rounded-md border border-stone-700 bg-stone-950 px-3 py-2"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={loading}
                  data-testid="listings-create-submit"
                  className="rounded-md bg-amber-700/90 px-4 py-2 font-medium text-stone-950 hover:bg-amber-600 disabled:opacity-50"
                >
                  Create listing
                </button>
              </div>
            </form>
          </section>
        ) : (
          <p className="mt-8 text-sm text-stone-500">
            <Link href="/login" className="text-amber-400 hover:underline">
              Log in
            </Link>{" "}
            to post a listing.
          </p>
        )}

        {msg && <p className="mt-6 text-sm text-emerald-400">{msg}</p>}
        {err && (
          <p data-testid="listings-api-error" className="mt-2 text-sm text-red-400">
            {err}
          </p>
        )}
      </main>
    </div>
  );
}
