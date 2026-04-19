"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  createListing,
  getListing,
  searchListings,
  type ListingSearchSort,
  type ListingJson,
} from "@/lib/api";
import { getStoredEmail, getStoredToken } from "@/lib/auth-storage";
import { Nav } from "@/components/Nav";
import { GoogleMapEmbed } from "@/components/GoogleMapEmbed";

const AMENITY_OPTIONS = [
  { slug: "garage", label: "Garage" },
  { slug: "parking", label: "Parking" },
  { slug: "in_unit_laundry", label: "In-unit laundry" },
  { slug: "dishwasher", label: "Dishwasher" },
] as const;

function parseUsdInputToCents(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.round(parsed * 100);
}

export default function ListingsPage() {
  const [email, setEmail] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [q, setQ] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [smokeFree, setSmokeFree] = useState(false);
  const [petFriendly, setPetFriendly] = useState(false);
  const [furnishedOnly, setFurnishedOnly] = useState(false);
  const [filterGarage, setFilterGarage] = useState(false);
  const [filterParking, setFilterParking] = useState(false);
  const [filterLaundry, setFilterLaundry] = useState(false);
  const [filterDishwasher, setFilterDishwasher] = useState(false);
  const [sortBy, setSortBy] = useState<ListingSearchSort>("created_desc");
  const [newWithin, setNewWithin] = useState<string>("");

  const [items, setItems] = useState<ListingJson[]>([]);
  const [detail, setDetail] = useState<ListingJson | null>(null);
  const [detailId, setDetailId] = useState("");

  // Search, detail load, and create each manage their own loading state.
  const [searchLoading, setSearchLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [priceUsd, setPriceUsd] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [createLat, setCreateLat] = useState("");
  const [createLng, setCreateLng] = useState("");
  const [createSmokeFree, setCreateSmokeFree] = useState(true);
  const [createPetFriendly, setCreatePetFriendly] = useState(false);
  const [createFurnished, setCreateFurnished] = useState(false);
  const [createGarage, setCreateGarage] = useState(false);
  const [createParking, setCreateParking] = useState(false);
  const [createLaundry, setCreateLaundry] = useState(false);
  const [createDishwasher, setCreateDishwasher] = useState(false);

  useEffect(() => {
    setToken(getStoredToken());
    setEmail(getStoredEmail());
  }, []);

  const buildCreateAmenities = (): string[] => {
    const parts: string[] = [];
    if (createGarage) parts.push("garage");
    if (createParking) parts.push("parking");
    if (createLaundry) parts.push("in_unit_laundry");
    if (createDishwasher) parts.push("dishwasher");
    return parts;
  };

  const onSearch = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      setErr(null);
      setSearchLoading(true);
      try {
        const minC = parseUsdInputToCents(minPrice);
        const maxC = parseUsdInputToCents(maxPrice);
        const nw = newWithin ? Number(newWithin) : undefined;
        const amenityParts: string[] = [];
        if (filterGarage) amenityParts.push("garage");
        if (filterParking) amenityParts.push("parking");
        if (filterLaundry) amenityParts.push("in_unit_laundry");
        if (filterDishwasher) amenityParts.push("dishwasher");
        const amenitiesParam = amenityParts.length
          ? amenityParts.join(",")
          : undefined;
        const list = await searchListings({
          q: q.trim() || undefined,
          min_price: minC,
          max_price: maxC,
          smoke_free: smokeFree,
          pet_friendly: petFriendly,
          furnished: furnishedOnly,
          amenities: amenitiesParam,
          new_within_days: nw != null && nw > 0 ? nw : undefined,
          sort: sortBy || "created_desc",
        });
        setItems(list);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Search failed");
        setItems([]);
      } finally {
        setSearchLoading(false);
      }
    },
    [
      q,
      minPrice,
      maxPrice,
      smokeFree,
      petFriendly,
      furnishedOnly,
      filterGarage,
      filterParking,
      filterLaundry,
      filterDishwasher,
      sortBy,
      newWithin,
    ],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setSearchLoading(true);
      setErr(null);
      try {
        const list = await searchListings({ sort: "created_desc" });
        if (!cancelled) setItems(list);
      } catch (e: unknown) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Could not load listings");
          setItems([]);
        }
      } finally {
        if (!cancelled) setSearchLoading(false);
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
    setDetailLoading(true);
    try {
      setDetail(await getListing(detailId.trim()));
    } catch (e: unknown) {
      setDetail(null);
      setErr(e instanceof Error ? e.message : "Load failed");
    } finally {
      setDetailLoading(false);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    setMsg(null);
    setErr(null);
    const cents = parseUsdInputToCents(priceUsd) ?? NaN;
    if (
      !title.trim() ||
      !Number.isFinite(cents) ||
      cents <= 0 ||
      !effectiveFrom
    ) {
      setErr("Title, positive price, and effective-from date required.");
      return;
    }
    const latN = createLat.trim() ? Number(createLat) : NaN;
    const lngN = createLng.trim() ? Number(createLng) : NaN;
    setCreateLoading(true);
    try {
      const created = await createListing(token, {
        title: title.trim(),
        description: desc.trim(),
        price_cents: cents,
        effective_from: effectiveFrom,
        smoke_free: createSmokeFree,
        pet_friendly: createPetFriendly,
        furnished: createFurnished,
        amenities: buildCreateAmenities(),
        latitude: Number.isFinite(latN) ? latN : null,
        longitude: Number.isFinite(lngN) ? lngN : null,
      });
      setMsg(`Listing created: ${created.title}`);
      setTitle("");
      setDesc("");
      setPriceUsd("");
      setCreateLat("");
      setCreateLng("");
      await onSearch();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Create failed");
    } finally {
      setCreateLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 via-white to-teal-50/30 text-slate-900">
      <Nav email={email} />
      <main className="mx-auto max-w-5xl px-4 py-10">
        <h1 className="font-serif text-3xl text-slate-900">Browse listings</h1>
        <p className="mt-2 text-sm text-slate-600">
          Filter by price, features, and recency. Listings with
          latitude/longitude show a map when{" "}
          <code className="rounded bg-slate-200 px-1 text-xs">
            NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
          </code>{" "}
          is set.{" "}
          <Link
            href="/dashboard"
            className="font-medium text-teal-700 hover:underline"
          >
            Dashboard
          </Link>{" "}
          for watchlist &amp; search history.
        </p>

        <form
          data-testid="listings-search-form"
          onSubmit={onSearch}
          className="mt-8 space-y-4 rounded-xl border border-slate-200 bg-white/80 p-6 shadow-sm"
        >
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="md:col-span-2">
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Keywords
              </label>
              <input
                data-testid="listings-search-q"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900"
                placeholder="studio, laundry…"
              />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Min price (USD)
              </label>
              <input
                type="number"
                step="0.01"
                value={minPrice}
                onChange={(e) => setMinPrice(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
              />
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Max price (USD)
              </label>
              <input
                type="number"
                step="0.01"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={smokeFree}
                onChange={(e) => setSmokeFree(e.target.checked)}
              />
              Smoke-free
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={petFriendly}
                onChange={(e) => setPetFriendly(e.target.checked)}
              />
              Pet-friendly
            </label>
            <label className="flex items-center gap-2">
              <input
                data-testid="listings-filter-furnished"
                type="checkbox"
                checked={furnishedOnly}
                onChange={(e) => setFurnishedOnly(e.target.checked)}
              />
              Furnished only
            </label>
            <label className="flex items-center gap-2">
              <input
                data-testid="listings-filter-garage"
                type="checkbox"
                checked={filterGarage}
                onChange={(e) => setFilterGarage(e.target.checked)}
              />
              Garage
            </label>
            <label className="flex items-center gap-2">
              <input
                data-testid="listings-filter-parking"
                type="checkbox"
                checked={filterParking}
                onChange={(e) => setFilterParking(e.target.checked)}
              />
              Parking
            </label>
            <label className="flex items-center gap-2">
              <input
                data-testid="listings-filter-laundry"
                type="checkbox"
                checked={filterLaundry}
                onChange={(e) => setFilterLaundry(e.target.checked)}
              />
              In-unit laundry
            </label>
            <label className="flex items-center gap-2">
              <input
                data-testid="listings-filter-dishwasher"
                type="checkbox"
                checked={filterDishwasher}
                onChange={(e) => setFilterDishwasher(e.target.checked)}
              />
              Dishwasher
            </label>
          </div>
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Sort by
              </label>
              <select
                data-testid="listings-sort"
                value={sortBy}
                onChange={(e) =>
                  setSortBy(e.target.value as ListingSearchSort)
                }
                className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="created_desc">Newest (created)</option>
                <option value="listed_desc">Listing date</option>
                <option value="price_asc">Price: low to high</option>
                <option value="price_desc">Price: high to low</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Listed recently
              </label>
              <select
                data-testid="listings-new-within"
                value={newWithin}
                onChange={(e) => setNewWithin(e.target.value)}
                className="mt-1 block rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Any time</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={searchLoading}
              data-testid="listings-search-submit"
              className="rounded-md bg-teal-600 px-4 py-2 font-medium text-white hover:bg-teal-500 disabled:opacity-50"
            >
              Search
            </button>
          </div>
        </form>

        <div
          data-testid="listings-results"
          className="mt-8 min-h-[3rem] space-y-3"
          aria-busy={searchLoading}
        >
          {items.length === 0 && !searchLoading && (
            <p className="text-sm text-slate-500">
              No listings match (or empty index).
            </p>
          )}
          {items.map((row) => (
            <div
              key={row.id}
              className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm"
            >
              <div className="font-medium text-slate-900">{row.title}</div>
              <div className="mt-1 text-slate-600">
                ${(row.price_cents / 100).toFixed(2)} ·{" "}
                <span className="font-mono text-xs text-slate-500">
                  {row.id}
                </span>
                {row.listed_at && (
                  <span className="ml-2 text-xs text-slate-500">
                    Listed {row.listed_at}
                  </span>
                )}
              </div>
              {row.amenities && row.amenities.length > 0 && (
                <p className="mt-1 text-xs text-slate-500">
                  Features: {row.amenities.join(", ")}
                </p>
              )}
              <div className="mt-3 max-w-md">
                {row.latitude != null && row.longitude != null ? (
                  <GoogleMapEmbed
                    latitude={row.latitude}
                    longitude={row.longitude}
                    height={160}
                    zoom={15}
                  />
                ) : (
                  <p className="text-xs text-slate-500">
                    No coordinates on this listing — add lat/lng when posting.
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        <section className="mt-12 rounded-xl border border-slate-200 bg-white/80 p-6 shadow-sm">
          <h2 className="text-lg font-medium text-slate-900">Listing by ID</h2>
          <form
            onSubmit={onLoadDetail}
            className="mt-4 flex flex-col gap-2 sm:flex-row"
          >
            <input
              data-testid="listings-detail-id"
              value={detailId}
              onChange={(e) => setDetailId(e.target.value)}
              placeholder="listing UUID"
              className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm"
            />
            <button
              type="submit"
              disabled={detailLoading}
              data-testid="listings-detail-load"
              className="rounded-md border border-slate-400 px-4 py-2 text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              Load
            </button>
          </form>
          {detail && (
            <pre
              data-testid="listings-detail-json"
              className="mt-4 overflow-x-auto rounded-md bg-slate-900 p-4 text-xs text-teal-100"
            >
              {JSON.stringify(detail, null, 2)}
            </pre>
          )}
        </section>

        {token ? (
          <section className="mt-10 rounded-xl border border-slate-200 bg-white/80 p-6 shadow-sm">
            <h2 className="text-lg font-medium text-slate-900">
              Post a listing
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Lister side: set optional coordinates for map preview (e.g.
              campus-adjacent). Features are stored in the DB as structured
              amenities for both search and display.
            </p>
            <form
              onSubmit={onCreate}
              className="mt-4 grid gap-3 md:grid-cols-2"
            >
              <div className="md:col-span-2">
                <label className="text-xs font-medium uppercase text-slate-500">
                  Title
                </label>
                <input
                  data-testid="listings-create-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                  required
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-medium uppercase text-slate-500">
                  Description
                </label>
                <textarea
                  data-testid="listings-create-desc"
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase text-slate-500">
                  Price (USD)
                </label>
                <input
                  data-testid="listings-create-price"
                  type="number"
                  step="0.01"
                  value={priceUsd}
                  onChange={(e) => setPriceUsd(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase text-slate-500">
                  Effective from
                </label>
                <input
                  data-testid="listings-create-effective-from"
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase text-slate-500">
                  Latitude (optional)
                </label>
                <input
                  data-testid="listings-create-lat"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. 42.3910"
                  value={createLat}
                  onChange={(e) => setCreateLat(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium uppercase text-slate-500">
                  Longitude (optional)
                </label>
                <input
                  data-testid="listings-create-lng"
                  type="text"
                  inputMode="decimal"
                  placeholder="e.g. -72.5267"
                  value={createLng}
                  onChange={(e) => setCreateLng(e.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm"
                />
              </div>
              <div className="md:col-span-2 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createSmokeFree}
                    onChange={(e) => setCreateSmokeFree(e.target.checked)}
                  />
                  Smoke-free
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createPetFriendly}
                    onChange={(e) => setCreatePetFriendly(e.target.checked)}
                  />
                  Pet-friendly
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createFurnished}
                    onChange={(e) => setCreateFurnished(e.target.checked)}
                  />
                  Furnished
                </label>
                {AMENITY_OPTIONS.map((a) => (
                  <label
                    key={a.slug}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="checkbox"
                      checked={
                        a.slug === "garage"
                          ? createGarage
                          : a.slug === "parking"
                            ? createParking
                            : a.slug === "in_unit_laundry"
                              ? createLaundry
                              : createDishwasher
                      }
                      onChange={(e) => {
                        if (a.slug === "garage")
                          setCreateGarage(e.target.checked);
                        else if (a.slug === "parking")
                          setCreateParking(e.target.checked);
                        else if (a.slug === "in_unit_laundry")
                          setCreateLaundry(e.target.checked);
                        else setCreateDishwasher(e.target.checked);
                      }}
                    />
                    {a.label}
                  </label>
                ))}
              </div>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={createLoading}
                  data-testid="listings-create-submit"
                  className="rounded-md bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-600 disabled:opacity-50"
                >
                  Create listing
                </button>
              </div>
            </form>
          </section>
        ) : (
          <p className="mt-8 text-sm text-slate-600">
            <Link
              href="/login"
              className="font-medium text-teal-700 hover:underline"
            >
              Log in
            </Link>{" "}
            to post a listing.
          </p>
        )}

        {msg && (
          <div
            data-testid="listing-created-banner"
            role="status"
            aria-live="polite"
            className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800"
          >
            {msg}
          </div>
        )}
        {err && (
          <p
            data-testid="listings-api-error"
            className="mt-2 text-sm text-red-600"
          >
            {err}
          </p>
        )}
      </main>
    </div>
  );
}
