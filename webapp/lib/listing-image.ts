import { normalizeMediaUrl } from "./media-url";

const DEMO_LISTING_IMAGES = [
  "/demo-listings/apartment-1.svg",
  "/demo-listings/apartment-2.svg",
  "/demo-listings/studio-1.svg",
  "/demo-listings/house-1.svg",
] as const;

function hashListingId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function isUnusableListingImageUrl(url: string | null | undefined): boolean {
  const u = String(url ?? "").trim().toLowerCase();
  if (!u) return true;
  if (u.includes("placehold.co")) return true;
  if (/1200\s*[x×]\s*800/.test(u)) return true;
  if (u.includes("via.placeholder.com")) return true;
  if (u.includes("dummyimage.com")) return true;
  return false;
}

export function demoListingImageForId(listingId: string): string {
  const idx = hashListingId(listingId) % DEMO_LISTING_IMAGES.length;
  return DEMO_LISTING_IMAGES[idx] ?? DEMO_LISTING_IMAGES[0];
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fallbackListingImageDataUri(opts?: {
  title?: string;
  residenceLabel?: string | null;
}): string {
  const label = escapeXmlText((opts?.residenceLabel || opts?.title || "Listing").slice(0, 28));
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300' role='img'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='%23e0f2fe'/><stop offset='100%' stop-color='%23cbd5e1'/></linearGradient></defs><rect width='400' height='300' fill='url(%23g)'/><text x='50%' y='46%' dominant-baseline='middle' text-anchor='middle' fill='%230f766e' font-family='system-ui,sans-serif' font-size='15' font-weight='600'>${label}</text><text x='50%' y='58%' dominant-baseline='middle' text-anchor='middle' fill='%2364748b' font-family='system-ui,sans-serif' font-size='12'>Photo coming soon</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function resolveListingCoverUrl(
  raw: string | null | undefined,
  listingId: string,
  opts?: { title?: string; residenceLabel?: string | null },
): string {
  const normalized = raw ? normalizeMediaUrl(raw) : "";
  if (!isUnusableListingImageUrl(normalized)) return normalized;
  if (listingId.trim()) return demoListingImageForId(listingId);
  return fallbackListingImageDataUri(opts);
}
