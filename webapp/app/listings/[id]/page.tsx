"use client";

import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { getListing, type ListingJson } from "@/lib/api";
import { getStoredEmail } from "@/lib/auth-storage";
import { Nav } from "@/components/Nav";
import { GoogleMapEmbed } from "@/components/GoogleMapEmbed";

function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatAmenity(amenity: string) {
  return amenity.replaceAll("_", " ");
}

function ListingDetailSkeleton() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.14),_transparent_28%),linear-gradient(180deg,_#f8fffd_0%,_#ffffff_34%,_#f8fafc_100%)] text-slate-900">
      <Nav email={getStoredEmail()} />

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="rounded-[2rem] border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-medium text-slate-500">
            Loading listing details…
          </p>
        </div>
      </main>
    </div>
  );
}

function ListingDetailPageContent({ listing }: { listing: ListingJson }) {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(45,212,191,0.14),_transparent_28%),linear-gradient(180deg,_#f8fffd_0%,_#ffffff_34%,_#f8fafc_100%)] text-slate-900">
      <Nav email={getStoredEmail()} />

      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <Link
          href="/listings"
          className="text-sm font-medium text-teal-700 transition hover:text-teal-600 hover:underline"
        >
          ← Back to listings
        </Link>

        <section className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
          <div className="space-y-6">
            <div className="overflow-hidden rounded-[2rem] border border-slate-200 bg-slate-50 shadow-sm">
              {listing.latitude != null && listing.longitude != null ? (
                <GoogleMapEmbed
                  latitude={listing.latitude}
                  longitude={listing.longitude}
                  height={320}
                  zoom={15}
                />
              ) : (
                <div className="flex h-[320px] items-center justify-center px-6 text-center text-sm text-slate-500">
                  This listing does not include map coordinates yet.
                </div>
              )}
            </div>

            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
                Listing overview
              </p>

              <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                    {listing.title}
                  </h1>
                  <p className="mt-3 text-sm text-slate-500">
                    Listing ID{" "}
                    <span className="font-mono text-xs">{listing.id}</span>
                  </p>
                </div>

                <div className="w-fit rounded-full bg-teal-50 px-4 py-2 text-base font-semibold text-teal-700">
                  {formatPrice(listing.price_cents)}
                </div>
              </div>

              <div className="mt-6 flex flex-wrap gap-2 text-xs text-slate-600">
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
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1"
                  >
                    {formatAmenity(amenity)}
                  </span>
                ))}
              </div>
            </section>

            <section className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <h2 className="text-2xl font-semibold tracking-tight text-slate-950">
                Description
              </h2>
              <p className="mt-4 whitespace-pre-wrap leading-7 text-slate-600">
                {listing.description?.trim() ||
                  "No description has been provided for this listing yet."}
              </p>
            </section>
          </div>

          <aside className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm lg:sticky lg:top-6">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-teal-700">
              Renter actions
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
              Next steps
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Save this listing, analyze the fit, or continue toward booking
              once backend support is available.
            </p>

            <div className="mt-6 space-y-3">
              <button
                type="button"
                disabled
                className="w-full rounded-full bg-teal-700 px-5 py-3 text-sm font-semibold text-white opacity-60"
              >
                Save listing
              </button>
              <button
                type="button"
                disabled
                className="w-full rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-800 opacity-60"
              >
                Analyze listing
              </button>
              <Link
                href={`/booking?listingId=${encodeURIComponent(listing.id)}`}
                className="block w-full rounded-full border border-slate-300 bg-white px-5 py-3 text-center text-sm font-medium text-slate-800 transition hover:border-slate-400 hover:bg-slate-50"
              >
                Start booking
              </Link>
              <button
                type="button"
                disabled
                className="w-full rounded-full border border-slate-200 bg-slate-50 px-5 py-3 text-sm font-medium text-slate-500"
              >
                Message landlord — coming soon
              </button>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

export default function ListingDetailPage() {
  const params = useParams<{ id?: string }>();
  const listingId = params.id;

  const [listing, setListing] = useState<ListingJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [shouldNotFound, setShouldNotFound] = useState(false);

  useEffect(() => {
    if (!listingId) {
      setShouldNotFound(true);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setShouldNotFound(false);

    void getListing(listingId)
      .then((nextListing) => {
        if (cancelled) return;
        setListing(nextListing);
      })
      .catch(() => {
        if (cancelled) return;
        setShouldNotFound(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [listingId]);

  if (loading) return <ListingDetailSkeleton />;

  if (shouldNotFound || !listing) {
    notFound();
  }

  return <ListingDetailPageContent listing={listing} />;
}
