import type { ListingJson } from "@/lib/api";

export type ListingFilters = {
  q: string;
  minPrice: string;
  maxPrice: string;
  bedrooms: string;
  bathrooms: string;
  residenceType: string;
  minSqft: string;
  maxSqft: string;
  campusWithinMiles: string;
  city: string;
  neighborhood: string;
  amenities: string[];
  /** Single date picker in FilterBar (legacy); occupancy range preferred for search. */
  availableFrom: string;
  occupancyStart: string;
  occupancyEnd: string;
  petFriendly: boolean;
  furnishedOnly: boolean;
  smokeFreeOnly: boolean;
  utilitiesIncluded: boolean;
  leaseMonthsMin: string;
  sort: string;
  pageSize: string;
  placeLabel: string;
  searchLat: number | null;
  searchLng: number | null;
  radiusMiles: string;
};

export type ListingCardProps = {
  id: string;
  coverImageUrl: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  residenceLabel?: string | null;
  squareFeet?: number | null;
  distanceToCampusMiles?: number;
  /** Shown as "Listed by …" on cards. */
  listedBy?: string | null;
  /** 1–5 average from completed peer reviews when `hostReviewCount` &gt; 0. */
  hostAvgRating?: number | null;
  hostReviewCount?: number;
  /** Listing owner — links host trust line to public feedback page. */
  hostUserId?: string | null;
  location?: string | null;
  amenities: string[];
  availableFrom?: string;
  title: string;
  description?: string | null;
  watchCount?: number;
  saved?: boolean;
  onToggleSave?: () => Promise<void>;
  onQuickBook?: () => Promise<void>;
  quickBooking?: boolean;
  /** Negotiation + availability (listings-service migration 19). */
  pricing_mode?: "fixed" | "obo" | string;
  listing_on_hold?: boolean;
  /** First viewport cards load images eagerly. */
  imagePriority?: boolean;
};

export type ListingCardViewModel = {
  listing: ListingJson;
  id: string;
  coverImageUrl: string;
  price: number;
  bedrooms: number;
  bathrooms: number;
  residenceLabel?: string | null;
  squareFeet?: number | null;
  distanceToCampusMiles?: number;
  listedBy?: string | null;
  hostAvgRating?: number | null;
  hostReviewCount?: number;
  hostUserId?: string | null;
  location?: string | null;
  amenities: string[];
  availableFrom?: string;
  title: string;
  description?: string | null;
  pricing_mode?: "fixed" | "obo" | string;
  listing_on_hold?: boolean;
};
