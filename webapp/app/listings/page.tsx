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

function ListingsHeaderSection() {
  return (
    <section className="max-w-3xl">
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
        Listings
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950 sm:text-5xl">
        Browse off-campus housing
      </h1>
      <p className="mt-4 text-lg leading-8 text-slate-600">
        Search listings by price, amenities, and recency to find options that
        match your needs. You can also continue to your{" "}
        <Link
          href="/dashboard"
          className="font-medium text-teal-700 hover:underline"
        >
          dashboard
        </Link>{" "}
        for watchlist and search history.
      </p>
    </section>
  );
}

function ListingsResultsSection({
  items,
  searchLoading,
}: {
  items: ListingJson[];
  searchLoading: boolean;
}) {
  return (
    <section
      data-testid="listings-results"
      className="mt-10"
      aria-busy={searchLoading}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
            Results
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
            Available listings
          </h2>
        </div>
        <p className="text-sm text-slate-500">
          {searchLoading
            ? "Updating results…"
            : `${items.length} listing${items.length === 1 ? "" : "s"} found`}
        </p>
      </div>
      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {items.length === 0 && !searchLoading && (
          <div className="mt-8 rounded-[1.75rem] border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
            <p className="text-base font-medium text-slate-900">
              No listings matched your current filters.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Try adjusting your search terms, price range, or amenities to see
              more options.
            </p>
          </div>
        )}
        {items.map((row) => (
          <article
            key={row.id}
            className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xl font-semibold text-slate-900">
                  {row.title}
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  Listing ID{" "}
                  <span className="font-mono text-xs text-slate-500">
                    {row.id}
                  </span>
                </p>
              </div>
              <div className="rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-700">
                ${(row.price_cents / 100).toFixed(2)}
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
              {row.smoke_free && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                  Smoke-free
                </span>
              )}
              {row.pet_friendly && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                  Pet-friendly
                </span>
              )}
              {row.furnished && (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
                  Furnished
                </span>
              )}
              {row.amenities?.map((amenity) => (
                <span
                  key={amenity}
                  className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1"
                >
                  {amenity.replaceAll("_", " ")}
                </span>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-500">
              {row.listed_at && <span>Listed {row.listed_at}</span>}
              {row.latitude != null && row.longitude != null ? (
                <span>Map preview available</span>
              ) : (
                <span>No coordinates provided</span>
              )}
            </div>

            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
              {row.latitude != null && row.longitude != null ? (
                <GoogleMapEmbed
                  latitude={row.latitude}
                  longitude={row.longitude}
                  height={180}
                  zoom={15}
                />
              ) : (
                <div className="flex h-[180px] items-center justify-center px-6 text-center text-sm text-slate-500">
                  This listing does not include map coordinates yet.
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ListingsFeedback({
  msg,
  err,
}: {
  msg: string | null;
  err: string | null;
}) {
  return (
    <>
      {msg && (
        <div
          data-testid="listing-created-banner"
          role="status"
          aria-live="polite"
          className="mt-6 rounded-[1.25rem] border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm font-medium text-emerald-800 shadow-sm"
        >
          {msg}
        </div>
      )}
      {err && (
        <div
          data-testid="listings-api-error"
          role="alert"
          className="mt-4 rounded-[1.25rem] border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700 shadow-sm"
        >
          {err}
        </div>
      )}
    </>
  );
}

function ListingsSearchSection({
  q,
  setQ,
  minPrice,
  setMinPrice,
  maxPrice,
  setMaxPrice,
  smokeFree,
  setSmokeFree,
  petFriendly,
  setPetFriendly,
  furnishedOnly,
  setFurnishedOnly,
  filterGarage,
  setFilterGarage,
  filterParking,
  setFilterParking,
  filterLaundry,
  setFilterLaundry,
  filterDishwasher,
  setFilterDishwasher,
  sortBy,
  setSortBy,
  newWithin,
  setNewWithin,
  searchLoading,
  onSearch,
}: {
  q: string;
  setQ: React.Dispatch<React.SetStateAction<string>>;
  minPrice: string;
  setMinPrice: React.Dispatch<React.SetStateAction<string>>;
  maxPrice: string;
  setMaxPrice: React.Dispatch<React.SetStateAction<string>>;
  smokeFree: boolean;
  setSmokeFree: React.Dispatch<React.SetStateAction<boolean>>;
  petFriendly: boolean;
  setPetFriendly: React.Dispatch<React.SetStateAction<boolean>>;
  furnishedOnly: boolean;
  setFurnishedOnly: React.Dispatch<React.SetStateAction<boolean>>;
  filterGarage: boolean;
  setFilterGarage: React.Dispatch<React.SetStateAction<boolean>>;
  filterParking: boolean;
  setFilterParking: React.Dispatch<React.SetStateAction<boolean>>;
  filterLaundry: boolean;
  setFilterLaundry: React.Dispatch<React.SetStateAction<boolean>>;
  filterDishwasher: boolean;
  setFilterDishwasher: React.Dispatch<React.SetStateAction<boolean>>;
  sortBy: ListingSearchSort;
  setSortBy: React.Dispatch<React.SetStateAction<ListingSearchSort>>;
  newWithin: string;
  setNewWithin: React.Dispatch<React.SetStateAction<string>>;
  searchLoading: boolean;
  onSearch: (e?: React.FormEvent) => Promise<void>;
}) {
  return (
    <form
      data-testid="listings-search-form"
      onSubmit={onSearch}
      className="mt-10 rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8"
    >
      <div className="max-w-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
          Search and filter
        </p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
          Narrow down your options
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Use keywords, pricing, amenities, and sort options to find listings
          that fit your budget and preferences.
        </p>
      </div>
      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Basics
        </p>
        <div className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <div className="md:col-span-2">
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Keywords
            </label>
            <input
              data-testid="listings-search-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-900"
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
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5"
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
              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5"
            />
          </div>
        </div>
      </div>

      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Preferences and amenities
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
            <input
              type="checkbox"
              checked={smokeFree}
              onChange={(e) => setSmokeFree(e.target.checked)}
            />
            Smoke-free
          </label>
          <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
            <input
              type="checkbox"
              checked={petFriendly}
              onChange={(e) => setPetFriendly(e.target.checked)}
            />
            Pet-friendly
          </label>
          <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
            <input
              data-testid="listings-filter-furnished"
              type="checkbox"
              checked={furnishedOnly}
              onChange={(e) => setFurnishedOnly(e.target.checked)}
            />
            Furnished only
          </label>
          <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
            <input
              data-testid="listings-filter-garage"
              type="checkbox"
              checked={filterGarage}
              onChange={(e) => setFilterGarage(e.target.checked)}
            />
            Garage
          </label>
          <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
            <input
              data-testid="listings-filter-parking"
              type="checkbox"
              checked={filterParking}
              onChange={(e) => setFilterParking(e.target.checked)}
            />
            Parking
          </label>
          <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
            <input
              data-testid="listings-filter-laundry"
              type="checkbox"
              checked={filterLaundry}
              onChange={(e) => setFilterLaundry(e.target.checked)}
            />
            In-unit laundry
          </label>
          <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
            <input
              data-testid="listings-filter-dishwasher"
              type="checkbox"
              checked={filterDishwasher}
              onChange={(e) => setFilterDishwasher(e.target.checked)}
            />
            Dishwasher
          </label>
        </div>
      </div>

      <div className="mt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
          Sorting and recency
        </p>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <div>
            <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Sort by
            </label>
            <select
              data-testid="listings-sort"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as ListingSearchSort)}
              className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
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
              className="mt-1 block rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm"
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
            className="rounded-full bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-600 disabled:opacity-50"
          >
            Search
          </button>
        </div>
      </div>
    </form>
  );
}

function ListingLookupSection({
  detailId,
  setDetailId,
  detailLoading,
  detail,
  onLoadDetail,
}: {
  detailId: string;
  setDetailId: React.Dispatch<React.SetStateAction<string>>;
  detailLoading: boolean;
  detail: ListingJson | null;
  onLoadDetail: (e: React.FormEvent) => Promise<void>;
}) {
  return (
    <section className="mt-14 rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
        Listing lookup
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
        Load a listing by ID
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
        Use a listing ID to inspect a specific record directly. This is a
        secondary utility for targeted lookups.
      </p>
      <form
        onSubmit={onLoadDetail}
        className="mt-6 flex flex-col gap-3 sm:flex-row"
      >
        <input
          data-testid="listings-detail-id"
          value={detailId}
          onChange={(e) => setDetailId(e.target.value)}
          placeholder="listing UUID"
          className="flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm text-slate-900"
        />
        <button
          type="submit"
          disabled={detailLoading}
          data-testid="listings-detail-load"
          className="rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-800 transition hover:border-slate-400 hover:bg-slate-50 disabled:opacity-50"
        >
          Load
        </button>
      </form>
      {detail && (
        <pre
          data-testid="listings-detail-json"
          className="mt-6 overflow-x-auto rounded-[1.25rem] bg-[#0f172a] p-5 text-xs leading-relaxed text-teal-100"
        >
          {JSON.stringify(detail, null, 2)}
        </pre>
      )}
    </section>
  );
}

function CreateListingSection({
  title,
  setTitle,
  desc,
  setDesc,
  priceUsd,
  setPriceUsd,
  effectiveFrom,
  setEffectiveFrom,
  createLat,
  setCreateLat,
  createLng,
  setCreateLng,
  createSmokeFree,
  setCreateSmokeFree,
  createPetFriendly,
  setCreatePetFriendly,
  createFurnished,
  setCreateFurnished,
  createGarage,
  setCreateGarage,
  createParking,
  setCreateParking,
  createLaundry,
  setCreateLaundry,
  createDishwasher,
  setCreateDishwasher,
  createLoading,
  onCreate,
}: {
  title: string;
  setTitle: React.Dispatch<React.SetStateAction<string>>;
  desc: string;
  setDesc: React.Dispatch<React.SetStateAction<string>>;
  priceUsd: string;
  setPriceUsd: React.Dispatch<React.SetStateAction<string>>;
  effectiveFrom: string;
  setEffectiveFrom: React.Dispatch<React.SetStateAction<string>>;
  createLat: string;
  setCreateLat: React.Dispatch<React.SetStateAction<string>>;
  createLng: string;
  setCreateLng: React.Dispatch<React.SetStateAction<string>>;
  createSmokeFree: boolean;
  setCreateSmokeFree: React.Dispatch<React.SetStateAction<boolean>>;
  createPetFriendly: boolean;
  setCreatePetFriendly: React.Dispatch<React.SetStateAction<boolean>>;
  createFurnished: boolean;
  setCreateFurnished: React.Dispatch<React.SetStateAction<boolean>>;
  createGarage: boolean;
  setCreateGarage: React.Dispatch<React.SetStateAction<boolean>>;
  createParking: boolean;
  setCreateParking: React.Dispatch<React.SetStateAction<boolean>>;
  createLaundry: boolean;
  setCreateLaundry: React.Dispatch<React.SetStateAction<boolean>>;
  createDishwasher: boolean;
  setCreateDishwasher: React.Dispatch<React.SetStateAction<boolean>>;
  createLoading: boolean;
  onCreate: (e: React.FormEvent) => Promise<void>;
}) {
  return (
    <section className="mt-10 rounded-[1.75rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
        Create listing
      </p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
        Post a new listing
      </h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
        Add listing details, optional coordinates for map preview, and
        structured amenities so listings can be searched and displayed
        consistently.
      </p>
      <form
        onSubmit={onCreate}
        className="mt-6 grid gap-4 md:grid-cols-2"
      >
        <div className="md:col-span-2">
          <label className="text-xs font-medium uppercase text-slate-500">
            Title
          </label>
          <input
            data-testid="listings-create-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5"
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
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5"
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
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5"
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
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5"
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
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm"
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
            className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm"
          />
        </div>
        <div className="md:col-span-2 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
            <input
              type="checkbox"
              checked={createSmokeFree}
              onChange={(e) => setCreateSmokeFree(e.target.checked)}
            />
            Smoke-free
          </label>
          <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
            <input
              type="checkbox"
              checked={createPetFriendly}
              onChange={(e) => setCreatePetFriendly(e.target.checked)}
            />
            Pet-friendly
          </label>
          <label className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
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
              className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2"
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
                  if (a.slug === "garage") setCreateGarage(e.target.checked);
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
            className="rounded-full bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-teal-600 disabled:opacity-50"
          >
            Create listing
          </button>
        </div>
      </form>
    </section>
  );
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
        const minC = minPrice ? Math.round(Number(minPrice) * 100) : undefined;
        const maxC = maxPrice ? Math.round(Number(maxPrice) * 100) : undefined;
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
    const cents = Math.round(Number(priceUsd) * 100);
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
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
        <ListingsHeaderSection />

        <ListingsSearchSection
          q={q}
          setQ={setQ}
          minPrice={minPrice}
          setMinPrice={setMinPrice}
          maxPrice={maxPrice}
          setMaxPrice={setMaxPrice}
          smokeFree={smokeFree}
          setSmokeFree={setSmokeFree}
          petFriendly={petFriendly}
          setPetFriendly={setPetFriendly}
          furnishedOnly={furnishedOnly}
          setFurnishedOnly={setFurnishedOnly}
          filterGarage={filterGarage}
          setFilterGarage={setFilterGarage}
          filterParking={filterParking}
          setFilterParking={setFilterParking}
          filterLaundry={filterLaundry}
          setFilterLaundry={setFilterLaundry}
          filterDishwasher={filterDishwasher}
          setFilterDishwasher={setFilterDishwasher}
          sortBy={sortBy}
          setSortBy={setSortBy}
          newWithin={newWithin}
          setNewWithin={setNewWithin}
          searchLoading={searchLoading}
          onSearch={onSearch}
        />

        <ListingsResultsSection
          items={items}
          searchLoading={searchLoading}
        />

        <ListingLookupSection
          detailId={detailId}
          setDetailId={setDetailId}
          detailLoading={detailLoading}
          detail={detail}
          onLoadDetail={onLoadDetail}
        />

        {token ? (
          <CreateListingSection
            title={title}
            setTitle={setTitle}
            desc={desc}
            setDesc={setDesc}
            priceUsd={priceUsd}
            setPriceUsd={setPriceUsd}
            effectiveFrom={effectiveFrom}
            setEffectiveFrom={setEffectiveFrom}
            createLat={createLat}
            setCreateLat={setCreateLat}
            createLng={createLng}
            setCreateLng={setCreateLng}
            createSmokeFree={createSmokeFree}
            setCreateSmokeFree={setCreateSmokeFree}
            createPetFriendly={createPetFriendly}
            setCreatePetFriendly={setCreatePetFriendly}
            createFurnished={createFurnished}
            setCreateFurnished={setCreateFurnished}
            createGarage={createGarage}
            setCreateGarage={setCreateGarage}
            createParking={createParking}
            setCreateParking={setCreateParking}
            createLaundry={createLaundry}
            setCreateLaundry={setCreateLaundry}
            createDishwasher={createDishwasher}
            setCreateDishwasher={setCreateDishwasher}
            createLoading={createLoading}
            onCreate={onCreate}
          />
        ) : (
          <p className="mt-10 rounded-[1.25rem] border border-slate-200 bg-white px-5 py-4 text-sm text-slate-600 shadow-sm">
            <Link
              href="/login"
              className="font-medium text-teal-700 hover:underline"
            >
              Log in
            </Link>{" "}
            to post a listing.
          </p>
        )}

        <ListingsFeedback
          msg={msg}
          err={err}
        />
      </main>
    </div>
  );
}
