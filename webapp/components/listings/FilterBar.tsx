"use client";

import type { ListingFilters } from "./types";

const AMENITY_OPTIONS = [
  { value: "garage", label: "Garage" },
  { value: "parking", label: "Parking" },
  { value: "in_unit_laundry", label: "Laundry" },
  { value: "dishwasher", label: "Dishwasher" },
  { value: "utilities_included", label: "Utilities included" },
] as const;

const RESIDENCE_OPTIONS = [
  { value: "", label: "Any type" },
  { value: "apartment", label: "Apartment" },
  { value: "house", label: "House" },
  { value: "townhouse", label: "Townhouse" },
  { value: "condo", label: "Condo" },
  { value: "studio", label: "Studio" },
  { value: "room", label: "Room" },
  { value: "duplex", label: "Duplex" },
  { value: "other", label: "Other" },
] as const;

const CAMPUS_DISTANCE_OPTIONS = [
  { value: "", label: "Any distance to campus" },
  { value: "0.5", label: "≤ 0.5 mi" },
  { value: "1", label: "≤ 1 mi" },
  { value: "2", label: "≤ 2 mi" },
  { value: "5", label: "≤ 5 mi" },
] as const;

type FilterBarProps = {
  filters: ListingFilters;
  disabled?: boolean;
  onChange: (next: ListingFilters) => void;
  onSubmit: () => Promise<void>;
};

export function FilterBar({ filters, disabled, onChange, onSubmit }: FilterBarProps) {
  const toggleAmenity = (value: string) => {
    const has = filters.amenities.includes(value);
    onChange({
      ...filters,
      amenities: has ? filters.amenities.filter((a) => a !== value) : [...filters.amenities, value],
    });
  };

  return (
    <section className="sticky top-0 z-10 mb-6 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-sm backdrop-blur">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <input
          data-testid="listings-search-q"
          value={filters.q}
          onChange={(e) => onChange({ ...filters, q: e.target.value })}
          placeholder="Search title, neighborhood, city…"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm lg:col-span-4"
        />
        <input
          type="number"
          value={filters.minPrice}
          onChange={(e) => onChange({ ...filters, minPrice: e.target.value })}
          placeholder="Min $ / mo"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm lg:col-span-2"
        />
        <input
          type="number"
          value={filters.maxPrice}
          onChange={(e) => onChange({ ...filters, maxPrice: e.target.value })}
          placeholder="Max $ / mo"
          className="rounded-md border border-slate-300 px-3 py-2 text-sm lg:col-span-2"
        />
        <select
          value={filters.bedrooms}
          onChange={(e) => onChange({ ...filters, bedrooms: e.target.value })}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm lg:col-span-2"
        >
          <option value="">Beds</option>
          <option value="1">1+ beds</option>
          <option value="2">2+ beds</option>
          <option value="3">3+ beds</option>
          <option value="4">4+ beds</option>
        </select>
        <select
          data-testid="listings-sort"
          value={filters.sort}
          onChange={(e) => onChange({ ...filters, sort: e.target.value })}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm lg:col-span-2"
        >
          <option value="created_desc">Newest</option>
          <option value="price_asc">Price low to high</option>
          <option value="price_desc">Price high to low</option>
          <option value="distance_asc">Distance to campus</option>
          <option value="listed_desc">Recently listed</option>
        </select>
        <select
          data-testid="listings-page-size"
          value={filters.pageSize}
          onChange={(e) => onChange({ ...filters, pageSize: e.target.value })}
          className="rounded-md border border-slate-300 px-3 py-2 text-sm lg:col-span-2"
          aria-label="Results per page"
        >
          {[24, 48, 72, 96, 120, 128, 240].map((n) => (
            <option key={n} value={String(n)}>
              {n} / page
            </option>
          ))}
        </select>
      </div>

      <details className="mt-3 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
        <summary className="cursor-pointer text-sm font-medium text-slate-800">More filters · size · location · campus</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6">
          <select
            value={filters.residenceType}
            onChange={(e) => onChange({ ...filters, residenceType: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {RESIDENCE_OPTIONS.map((o) => (
              <option key={o.value || "any"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={filters.minSqft}
            onChange={(e) => onChange({ ...filters, minSqft: e.target.value })}
            placeholder="Min sq ft"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            type="number"
            value={filters.maxSqft}
            onChange={(e) => onChange({ ...filters, maxSqft: e.target.value })}
            placeholder="Max sq ft"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={filters.campusWithinMiles}
            onChange={(e) => onChange({ ...filters, campusWithinMiles: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm xl:col-span-2"
          >
            {CAMPUS_DISTANCE_OPTIONS.map((o) => (
              <option key={o.value || "anyd"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={filters.bathrooms}
            onChange={(e) => onChange({ ...filters, bathrooms: e.target.value })}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="">Baths</option>
            <option value="1">1+ baths</option>
            <option value="2">2+ baths</option>
            <option value="3">3+ baths</option>
          </select>
          <input
            value={filters.city}
            onChange={(e) => onChange({ ...filters, city: e.target.value })}
            placeholder="City"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            value={filters.neighborhood}
            onChange={(e) => onChange({ ...filters, neighborhood: e.target.value })}
            placeholder="Neighborhood / area"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm xl:col-span-2"
          />
        </div>
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {AMENITY_OPTIONS.map((a) => (
          <label
            key={a.value}
            className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${filters.amenities.includes(a.value) ? "border-teal-600 bg-teal-50 text-teal-700" : "border-slate-300 bg-white text-slate-600"}`}
          >
            <input
              data-testid={`listings-filter-${a.value === "in_unit_laundry" ? "laundry" : a.value}`}
              type="checkbox"
              checked={filters.amenities.includes(a.value)}
              onChange={() => toggleAmenity(a.value)}
            />
            {a.label}
          </label>
        ))}
        <label className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={filters.petFriendly}
            onChange={(e) => onChange({ ...filters, petFriendly: e.target.checked })}
          />
          Pets OK
        </label>
        <label className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={filters.furnishedOnly}
            onChange={(e) => onChange({ ...filters, furnishedOnly: e.target.checked })}
          />
          Furnished
        </label>
        <label className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={filters.smokeFreeOnly}
            onChange={(e) => onChange({ ...filters, smokeFreeOnly: e.target.checked })}
          />
          Smoke-free
        </label>
        <label className="flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={filters.utilitiesIncluded}
            onChange={(e) => {
              const on = e.target.checked;
              const nextAmenities = on
                ? filters.amenities.includes("utilities_included")
                  ? [...filters.amenities]
                  : [...filters.amenities, "utilities_included"]
                : filters.amenities.filter((x) => x !== "utilities_included");
              onChange({ ...filters, utilitiesIncluded: on, amenities: nextAmenities });
            }}
          />
          Utilities incl.
        </label>
        <input
          data-testid="listings-new-within"
          type="date"
          value={filters.availableFrom}
          onChange={(e) => onChange({ ...filters, availableFrom: e.target.value })}
          className="ml-auto rounded-md border border-slate-300 px-3 py-1.5 text-xs"
        />
        <button
          data-testid="listings-search-submit"
          type="button"
          disabled={disabled}
          onClick={() => void onSubmit()}
          className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-500 disabled:opacity-50"
        >
          Apply
        </button>
      </div>
    </section>
  );
}
