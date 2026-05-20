"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { fallbackListingImageDataUri, resolveListingCoverUrl } from "@/lib/listing-image";
import { prettyListingDescription, prettyListingTitle } from "@/lib/listing-display";
import type { ListingCardProps } from "./types";

function amenityChip(slug: string): string {
  const k = slug.toLowerCase();
  if (k === "in_unit_laundry") return "Laundry";
  if (k === "pet_friendly") return "Pet friendly";
  return k
    .split(/[_-]+/)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

export function ListingCard({
  id,
  coverImageUrl,
  price,
  bedrooms,
  bathrooms,
  residenceLabel,
  squareFeet,
  distanceToCampusMiles,
  location,
  listedBy,
  hostAvgRating,
  hostReviewCount,
  hostUserId,
  amenities,
  availableFrom,
  watchCount,
  title,
  description,
  onQuickBook,
  quickBooking,
  saved,
  onToggleSave,
  pricing_mode,
  listing_on_hold,
  imagePriority = false,
}: ListingCardProps) {
  const router = useRouter();
  const [imageFailed, setImageFailed] = useState(false);
  const resolvedCover = useMemo(
    () =>
      resolveListingCoverUrl(coverImageUrl, id, {
        title: prettyListingTitle(title),
        residenceLabel,
      }),
    [coverImageUrl, id, title, residenceLabel],
  );
  const imageSrc = imageFailed
    ? fallbackListingImageDataUri({ title: prettyListingTitle(title), residenceLabel })
    : resolvedCover;
  const detailHref = `/listings/${id}`;
  const feedbackHref =
    hostUserId && String(hostUserId).trim() ? `/users/${encodeURIComponent(String(hostUserId).trim())}` : null;
  const prefetchDetail = () => {
    try {
      void router.prefetch(detailHref);
    } catch {
      /* older Next — ignore */
    }
  };

  return (
    <article
      data-testid="listing-card"
      className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl"
    >
      <Link
        href={detailHref}
        prefetch
        scroll
        onMouseEnter={prefetchDetail}
        className="block cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2"
      >
        <div className="relative aspect-[4/3] overflow-hidden bg-slate-100">
          <img
            src={imageSrc}
            alt={prettyListingTitle(title) || "Housing listing"}
            width={400}
            height={300}
            loading={imagePriority ? "eager" : "lazy"}
            decoding="async"
            fetchPriority={imagePriority ? "high" : "auto"}
            onError={() => {
              if (!imageFailed) setImageFailed(true);
            }}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
          <span className="absolute left-2 top-2 flex flex-wrap gap-1" aria-label="Listing badges">
            {String(pricing_mode || "").toLowerCase() === "obo" ? (
              <span className="rounded-full bg-violet-600/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow">
                Best offer
              </span>
            ) : null}
            {listing_on_hold ? (
              <span className="rounded-full bg-amber-600/95 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white shadow">
                On hold
              </span>
            ) : null}
          </span>
          <span
            className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-xs font-medium text-slate-800 shadow"
            data-testid="listing-card-watch-count"
            title="How many renters have this listing on their watchlist"
          >
            ♥{" "}
            {watchCount != null && Number.isFinite(Number(watchCount))
              ? Math.max(0, Math.floor(Number(watchCount)))
              : 0}{" "}
            <span className="sr-only">watchers</span>
          </span>
        </div>
        <div className="space-y-2 p-4">
          <div className="text-xl font-bold text-slate-900">
            ${price.toLocaleString()} / month
            {String(pricing_mode || "").toLowerCase() === "obo" ? (
              <span className="ml-2 text-sm font-medium text-violet-700">· Open to offers</span>
            ) : null}
          </div>
          <div className="text-sm text-slate-600">
            {residenceLabel ? <span className="mr-1 font-medium text-slate-700">{residenceLabel} · </span> : null}
            {bedrooms} Bed · {bathrooms} Bath
            {squareFeet != null && Number.isFinite(squareFeet) ? <> · {squareFeet.toLocaleString()} sq ft</> : null}
            {distanceToCampusMiles !== undefined ? <> · {distanceToCampusMiles.toFixed(1)} mi to campus</> : <> · Distance unavailable</>}
          </div>
          {location ? <p className="line-clamp-1 text-xs text-slate-500">{location}</p> : null}
          <div className="text-xs text-slate-600">
            <p className="line-clamp-1">
              {listedBy ? (
                <>
                  <span className="text-slate-500">Host </span>
                  <span className="font-medium text-slate-800">{listedBy}</span>
                </>
              ) : (
                <span className="text-slate-500">Host</span>
              )}
            </p>
            <p className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">
              {feedbackHref ? (
                <Link
                  href={feedbackHref}
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex flex-wrap items-center gap-x-1 text-teal-800 hover:underline"
                  title="Host profile, star average, and full review text"
                >
                  {(hostReviewCount ?? 0) > 0 && hostAvgRating != null && Number.isFinite(hostAvgRating) ? (
                    <>
                      <span className="text-amber-500" aria-hidden>
                        {"★".repeat(Math.min(5, Math.max(0, Math.round(hostAvgRating))))}
                        {"☆".repeat(Math.max(0, 5 - Math.min(5, Math.round(hostAvgRating))))}
                      </span>
                      <span className="ml-1 tabular-nums text-slate-600">{hostAvgRating.toFixed(1)}</span>
                      <span className="text-slate-500">
                        {" "}
                        · {hostReviewCount} review{hostReviewCount === 1 ? "" : "s"}
                      </span>
                    </>
                  ) : (
                    <span>No reviews yet — open host profile</span>
                  )}
                </Link>
              ) : (hostReviewCount ?? 0) > 0 && hostAvgRating != null && Number.isFinite(hostAvgRating) ? (
                <>
                  <span className="text-amber-500" aria-hidden>
                    {"★".repeat(Math.min(5, Math.max(0, Math.round(hostAvgRating))))}
                    {"☆".repeat(Math.max(0, 5 - Math.min(5, Math.round(hostAvgRating))))}
                  </span>
                  <span className="ml-1 tabular-nums text-slate-600">{hostAvgRating.toFixed(1)}</span>
                  <span className="text-slate-500">
                    {" "}
                    · {hostReviewCount} review{hostReviewCount === 1 ? "" : "s"}
                  </span>
                </>
              ) : (
                <span>No reviews yet</span>
              )}
            </p>
          </div>
          <p className="line-clamp-1 text-sm font-medium text-slate-800">{prettyListingTitle(title)}</p>
          <p className="line-clamp-2 text-xs text-slate-500">
            {prettyListingDescription(description || undefined)}
          </p>
          {amenities.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {amenities.map((a) => (
                <span key={a} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700">
                  {amenityChip(a)}
                </span>
              ))}
            </div>
          ) : null}
          {availableFrom ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800">
              <p className="font-semibold">Availability calendar</p>
              <p>📅 Opens {new Date(availableFrom).toLocaleDateString()}</p>
            </div>
          ) : null}
        </div>
      </Link>
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3">
        <Link
          href={detailHref}
          prefetch
          onClick={(e) => e.stopPropagation()}
          onMouseEnter={prefetchDetail}
          className="text-sm font-semibold text-blue-600 hover:underline"
        >
          View Details
        </Link>
        <button
          type="button"
          disabled={!onQuickBook || quickBooking}
          onClick={(e) => {
            e.stopPropagation();
            void onQuickBook?.();
          }}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {quickBooking ? "Booking..." : "Book"}
        </button>
        <button
          type="button"
          data-testid={`listing-card-watchlist-${id}`}
          title={saved ? "Remove from your watchlist" : "Save to your watchlist (same as listing detail)"}
          onClick={(e) => {
            e.stopPropagation();
            void onToggleSave?.();
          }}
          className={`rounded-lg px-3 py-1.5 text-sm ${
            saved ? "bg-rose-100 text-rose-700" : "border border-slate-300 bg-white text-slate-700"
          }`}
        >
          {saved ? "In watchlist" : "Watchlist"}
        </button>
      </div>
    </article>
  );
}
