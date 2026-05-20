"use client";

import type { ListingJson } from "@/lib/api";
import { formatPublicHostLabel } from "@/lib/listing-display";
import { resolveListingCoverUrl } from "@/lib/listing-image";
import { ListingCard } from "./ListingCard";
import type { ListingCardViewModel } from "./types";

type ListingsGridProps = {
  items: ListingJson[];
  quickBookingId?: string | null;
  onQuickBook: (listing: ListingJson) => Promise<void>;
  savedIds: Set<string>;
  onToggleSave: (listing: ListingJson) => Promise<void>;
  /** When false, suppress empty copy until first search completes. */
  listingsLoaded?: boolean;
};

export function ListingsGrid({
  items,
  onQuickBook,
  quickBookingId,
  savedIds,
  onToggleSave,
  listingsLoaded = true,
}: ListingsGridProps) {
  if (listingsLoaded && items.length === 0) {
    return (
      <p
        className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-sm text-slate-500"
        data-testid="listings-empty"
      >
        No listings match your filters yet.
      </p>
    );
  }
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      {items.map((listing) => {
        const vm = toViewModel(listing);
        return (
          <ListingCard
            key={listing.id}
            {...vm}
            watchCount={listing.watch_count}
            saved={savedIds.has(listing.id)}
            onToggleSave={async () => onToggleSave(vm.listing)}
            onQuickBook={async () => onQuickBook(vm.listing)}
            quickBooking={quickBookingId === listing.id}
          />
        );
      })}
    </div>
  );
}

function formatResidenceLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).replace(/_/g, " ").trim();
  if (!s) return null;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toViewModel(listing: ListingJson): ListingCardViewModel {
  const bedrooms = listing.bedrooms && Number.isFinite(Number(listing.bedrooms)) ? Number(listing.bedrooms) : 1;
  const bathrooms = listing.bathrooms && Number.isFinite(Number(listing.bathrooms)) ? Number(listing.bathrooms) : 1;
  const sq =
    listing.square_feet != null && Number.isFinite(Number(listing.square_feet))
      ? Math.floor(Number(listing.square_feet))
      : listing.size_sqft != null && Number.isFinite(Number(listing.size_sqft))
        ? Math.floor(Number(listing.size_sqft))
        : null;
  const coverFromMedia = (): string => {
    const mi = listing.media_items;
    if (Array.isArray(mi) && mi.length) {
      const first = [...mi].sort((a, b) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))[0];
      const u = first?.url_or_path ? String(first.url_or_path) : "";
      if (u) return u;
    }
    const legacy = listing.images?.[0];
    return legacy ? String(legacy) : "";
  };
  const residenceLabel = formatResidenceLabel(listing.residence_type);
  const rawCover = coverFromMedia();
  return {
    listing,
    id: listing.id,
    coverImageUrl: resolveListingCoverUrl(rawCover, listing.id, {
      title: listing.title,
      residenceLabel,
    }),
    price: Math.round(Number(listing.price_cents || 0) / 100),
    bedrooms,
    bathrooms,
    residenceLabel,
    squareFeet: sq,
    distanceToCampusMiles:
      listing.distance_miles_to_campus != null && Number.isFinite(Number(listing.distance_miles_to_campus))
        ? Number(listing.distance_miles_to_campus)
        : estimateDistanceMiles(listing.latitude, listing.longitude),
    listedBy: formatPublicHostLabel(listing.landlord_display) || null,
    hostAvgRating: listing.host_avg_rating ?? null,
    hostReviewCount: listing.host_review_count ?? 0,
    hostUserId: listing.user_id ? String(listing.user_id) : null,
    location: listing.location || listing.display_location || null,
    amenities: listing.amenities || [],
    availableFrom: listing.lease_terms?.effective_from || listing.listed_at || undefined,
    title: listing.title,
    description: listing.description,
    pricing_mode: String(listing.pricing_mode || "fixed").toLowerCase() === "obo" ? "obo" : "fixed",
    listing_on_hold: Boolean(listing.listing_on_hold),
  };
}

function estimateDistanceMiles(lat?: number | null, lng?: number | null): number | undefined {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return undefined;
  const campusLat = 42.3868;
  const campusLng = -72.5301;
  const dLat = ((Number(lat) - campusLat) * Math.PI) / 180;
  const dLng = ((Number(lng) - campusLng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((campusLat * Math.PI) / 180) *
      Math.cos((Number(lat) * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 3958.8 * c;
}
