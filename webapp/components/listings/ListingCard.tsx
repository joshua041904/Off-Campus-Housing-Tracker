import Link from "next/link";
import { GoogleMapEmbed } from "@/components/GoogleMapEmbed";
import type { ListingJson } from "@/lib/api";

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatAmenity(amenity: string) {
  return amenity.replaceAll("_", " ");
}

export function ListingCard({ listing }: { listing: ListingJson }) {
  return (
    <article className="rounded-[1.75rem] border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href={`/listings/${encodeURIComponent(listing.id)}`}
            className="text-xl font-semibold text-slate-900 transition hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
          >
            {listing.title}
          </Link>
          <p className="mt-2 text-sm text-slate-500">
            Listing ID{" "}
            <span className="font-mono text-xs text-slate-500">
              {listing.id}
            </span>
          </p>
        </div>

        <div className="rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-700">
          {formatPrice(listing.price_cents)}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
        {listing.smoke_free && (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
            Smoke-free
          </span>
        )}
        {listing.pet_friendly && (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
            Pet-friendly
          </span>
        )}
        {listing.furnished && (
          <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1">
            Furnished
          </span>
        )}
        {listing.amenities?.map((amenity) => (
          <span
            key={amenity}
            className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 capitalize"
          >
            {formatAmenity(amenity)}
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-sm text-slate-500">
        {listing.listed_at && <span>Listed {listing.listed_at}</span>}
        {listing.latitude != null && listing.longitude != null ? (
          <span>Map preview available</span>
        ) : (
          <span>No coordinates provided</span>
        )}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
        {listing.latitude != null && listing.longitude != null ? (
          <GoogleMapEmbed
            latitude={listing.latitude}
            longitude={listing.longitude}
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
  );
}
