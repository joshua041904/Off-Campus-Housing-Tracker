import type { BookingListingCard } from "@/lib/api";
import { prettyListingTitle } from "@/lib/listing-display";

type Props = {
  listing?: BookingListingCard | null;
  /** Shown when no listing object (e.g. legacy rows). */
  fallbackTitle?: string | null;
  className?: string;
};

export function BookingListingInline({ listing, fallbackTitle, className = "" }: Props) {
  const title = prettyListingTitle(
    (listing?.title ?? "").trim() || (fallbackTitle ?? "").trim() || "Listing",
  );
  const price = listing?.price_usd_monthly;
  const loc = listing?.location?.trim();
  const img = listing?.primary_image_url?.trim();

  const missingCard = !listing;

  return (
    <div className={`flex gap-3 items-start ${className}`}>
      {img ? (
        <img src={img} alt="" className="h-16 w-16 shrink-0 rounded border border-slate-200 object-cover" />
      ) : (
        <div className="h-16 w-16 shrink-0 rounded border border-slate-200 bg-slate-100" aria-hidden />
      )}
      <div className="min-w-0 flex-1">
        {missingCard ? (
          <p className="text-xs text-slate-400">Live listing card could not be loaded; showing saved title only.</p>
        ) : null}
        <p className="font-medium text-slate-900 truncate">{title}</p>
        {price != null && Number.isFinite(price) ? (
          <p className="text-sm text-slate-600">${price.toLocaleString(undefined, { maximumFractionDigits: 0 })}/mo</p>
        ) : null}
        {loc ? <p className="text-xs text-slate-500 truncate">{loc}</p> : null}
      </div>
    </div>
  );
}
