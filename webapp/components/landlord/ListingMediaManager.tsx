"use client";

import { useCallback, useMemo, useState } from "react";
import {
  deleteListingMedia,
  mediaUploadTokenized,
  postListingMedia,
  reorderListingMedia,
  type ListingJson,
} from "@/lib/api";
import { isAcceptedListingImageUploadUrl } from "@/lib/listing-media-url";
import { normalizeMediaUrl } from "@/lib/media-url";

export type MediaRow = { id: string; url_or_path: string; media_type: string; sort_order: number };

type Props = {
  token: string;
  listingId: string;
  listing: ListingJson;
  disabled?: boolean;
  onListingUpdated: (next: ListingJson) => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
};

function sortedMedia(listing: ListingJson): MediaRow[] {
  const raw = listing.media_items;
  if (Array.isArray(raw) && raw.length) {
    return [...raw].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  }
  const imgs = listing.images || [];
  return imgs.map((url, i) => ({
    id: `legacy-${i}-${url.slice(-24)}`,
    url_or_path: url,
    media_type: "image",
    sort_order: i,
  }));
}

export function ListingMediaManager({
  token,
  listingId,
  listing,
  disabled,
  onListingUpdated,
  onError,
  onNotice,
}: Props) {
  const [busy, setBusy] = useState(false);
  const rows = sortedMedia(listing);
  const hasLegacyIds = rows.some((r) => r.id.startsWith("legacy-"));
  const [carouselIndex, setCarouselIndex] = useState(0);

  const safeIndex = useMemo(() => {
    if (!rows.length) return 0;
    return Math.min(Math.max(0, carouselIndex), rows.length - 1);
  }, [carouselIndex, rows.length]);

  const current = rows[safeIndex];

  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      onNotice(null);
      onError(null);
      try {
        await fn();
      } catch (e: unknown) {
        onError(e instanceof Error ? e.message : "Media action failed");
      } finally {
        setBusy(false);
      }
    },
    [onError, onNotice],
  );

  async function onAddFiles(files: FileList | null) {
    if (!files?.length) return;
    await run(async () => {
      for (const f of Array.from(files)) {
        const isVid = f.type.startsWith("video/");
        const { url } = await mediaUploadTokenized(token, f);
        if (!isAcceptedListingImageUploadUrl(url)) {
          onError(
            isVid
              ? "Video upload did not return a usable URL (https or OCH /api/media/...). You can also paste a hosted https link in the field below."
              : "Upload did not return a usable image URL (https or /api/media/... from OCH media).",
          );
          return;
        }
        const { listing: next } = await postListingMedia(token, listingId, {
          media_url: url,
          media_type: isVid ? "video" : "image",
        });
        onListingUpdated(next);
      }
      onNotice("Media updated.");
    });
  }

  async function onRemove(id: string) {
    if (id.startsWith("legacy-")) {
      onError("This image predates per-file media ids. Save other edits, then re-upload photos to manage them individually.");
      return;
    }
    await run(async () => {
      const next = await deleteListingMedia(token, listingId, id);
      onListingUpdated(next);
      setCarouselIndex(0);
      onNotice("Removed item.");
    });
  }

  async function move(ix: number, dir: -1 | 1) {
    const j = ix + dir;
    if (j < 0 || j >= rows.length) return;
    if (hasLegacyIds) {
      onError("Reordering needs media rows with ids from the server. Re-upload images once to refresh.");
      return;
    }
    const nextOrder = [...rows];
    const t = nextOrder[ix]!;
    nextOrder[ix] = nextOrder[j]!;
    nextOrder[j] = t;
    await run(async () => {
      const next = await reorderListingMedia(
        token,
        listingId,
        nextOrder.map((r) => r.id),
      );
      onListingUpdated(next);
      setCarouselIndex((prev) => {
        if (prev === ix) return j;
        if (prev === j) return ix;
        return prev;
      });
      onNotice("Order saved.");
    });
  }

  function stepCarousel(delta: -1 | 1) {
    if (!rows.length) return;
    setCarouselIndex((i) => {
      const n = rows.length;
      return (i + delta + n) % n;
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">Photos &amp; video</p>
          <p className="text-xs text-slate-600">
            Upload multiple files. Use arrows to browse (eBay-style). “Earlier / later” changes the public gallery order.
          </p>
        </div>
        <label className="cursor-pointer rounded-md border border-teal-700 bg-white px-3 py-1.5 text-xs font-medium text-teal-900 hover:bg-teal-50 disabled:opacity-50">
          <input
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            disabled={disabled || busy}
            onChange={(e) => void onAddFiles(e.target.files)}
          />
          {busy ? "Working…" : "Add images / videos"}
        </label>
      </div>

      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-amber-900">No photos yet — add at least one image before publishing.</p>
      ) : (
        <>
          <div className="relative mt-4 overflow-hidden rounded-lg border border-slate-200 bg-black/5">
            <div className="flex aspect-video items-center justify-center bg-slate-900/5">
              {current?.media_type === "video" ? (
                <video
                  key={current.id}
                  src={normalizeMediaUrl(current.url_or_path)}
                  className="max-h-full max-w-full"
                  controls
                  playsInline
                />
              ) : (
                <img
                  key={current?.id}
                  src={normalizeMediaUrl(current?.url_or_path || "")}
                  alt=""
                  className="max-h-full max-w-full object-contain"
                />
              )}
            </div>
            <div className="absolute inset-y-0 left-0 flex items-center">
              <button
                type="button"
                disabled={disabled || busy || rows.length < 2}
                onClick={() => stepCarousel(-1)}
                className="m-2 rounded-full bg-white/90 px-3 py-2 text-sm font-semibold text-slate-800 shadow hover:bg-white disabled:opacity-30"
                aria-label="Previous image or video"
              >
                ←
              </button>
            </div>
            <div className="absolute inset-y-0 right-0 flex items-center">
              <button
                type="button"
                disabled={disabled || busy || rows.length < 2}
                onClick={() => stepCarousel(1)}
                className="m-2 rounded-full bg-white/90 px-3 py-2 text-sm font-semibold text-slate-800 shadow hover:bg-white disabled:opacity-30"
                aria-label="Next image or video"
              >
                →
              </button>
            </div>
            <p className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-0.5 text-[11px] text-white">
              {safeIndex + 1} / {rows.length}
            </p>
          </div>

          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {rows.map((m, ix) => (
              <li
                key={m.id}
                className={`flex gap-3 rounded-md border p-2 shadow-sm ${
                  ix === safeIndex ? "border-teal-500 bg-teal-50/50" : "border-slate-200 bg-white"
                }`}
              >
                <button
                  type="button"
                  className="relative h-24 w-28 shrink-0 overflow-hidden rounded bg-slate-100"
                  onClick={() => setCarouselIndex(ix)}
                >
                  {m.media_type === "video" ? (
                    <div className="flex h-full items-center justify-center text-[10px] text-slate-600">Video</div>
                  ) : (
                    <img src={normalizeMediaUrl(m.url_or_path)} alt="" className="h-full w-full object-cover" />
                  )}
                </button>
                <div className="flex min-w-0 flex-1 flex-col justify-between gap-1">
                  <p className="truncate text-[11px] text-slate-500">{m.media_type}</p>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      disabled={disabled || busy || ix === 0}
                      onClick={() => void move(ix, -1)}
                      className="rounded border border-slate-200 px-2 py-0.5 text-[11px] hover:bg-slate-50 disabled:opacity-40"
                    >
                      Earlier
                    </button>
                    <button
                      type="button"
                      disabled={disabled || busy || ix === rows.length - 1}
                      onClick={() => void move(ix, 1)}
                      className="rounded border border-slate-200 px-2 py-0.5 text-[11px] hover:bg-slate-50 disabled:opacity-40"
                    >
                      Later
                    </button>
                    <button
                      type="button"
                      disabled={disabled || busy}
                      onClick={() => void onRemove(m.id)}
                      className="rounded border border-rose-200 px-2 py-0.5 text-[11px] text-rose-800 hover:bg-rose-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
