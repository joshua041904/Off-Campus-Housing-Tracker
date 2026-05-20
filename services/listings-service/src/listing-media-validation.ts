export const MAX_LISTING_IMAGES_PER_CREATE = Math.min(
  24,
  Math.max(1, Number(process.env.MAX_LISTING_IMAGES_PER_CREATE || "16") || 16),
);

export type ListingImageUrlValidation =
  | { ok: true }
  | { ok: false; message: string };

/** Same-origin paths proxied to media-service (inline signed URLs, etc.). */
function isOchMediaGatewayPath(raw: string): boolean {
  const s = String(raw).trim();
  if (!s.startsWith("/")) return false;
  return s.startsWith("/api/media/") || s.startsWith("/media/");
}

export function validateListingImageUrlShape(url: string): ListingImageUrlValidation {
  const raw = String(url).trim();
  if (!raw) {
    return { ok: false, message: "empty image URL" };
  }
  if (isOchMediaGatewayPath(raw)) {
    return { ok: true };
  }
  try {
    const u = new URL(raw);
    if (u.protocol === "https:") {
      return { ok: true };
    }
    if (
      u.protocol === "http:" &&
      (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]")
    ) {
      return { ok: true };
    }
    return {
      ok: false,
      message: `invalid image URL (https or /api/media/... path required): ${raw.slice(0, 96)}`,
    };
  } catch {
    return {
      ok: false,
      message: `invalid image URL: ${raw.slice(0, 96)}`,
    };
  }
}

export async function validateListingImageUrlHead(
  url: string,
): Promise<ListingImageUrlValidation> {
  const shape = validateListingImageUrlShape(url);
  if (!shape.ok) return shape;
  const raw = String(url).trim();
  if (isOchMediaGatewayPath(raw)) {
    return { ok: true };
  }
  if (
    process.env.LISTINGS_SKIP_MEDIA_HEAD === "1" ||
    process.env.LISTINGS_SKIP_MEDIA_HEAD === "true" ||
    process.env.VITEST === "true"
  ) {
    return { ok: true };
  }
  try {
    const res = await fetch(raw, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
      redirect: "follow",
    });
    const ct = res.headers.get("content-type") || "";
    if (res.ok && /^image\//i.test(ct)) {
      return { ok: true };
    }
    return {
      ok: false,
      message: `image URL failed validation: ${raw.slice(0, 96)}`,
    };
  } catch {
    return {
      ok: false,
      message: `image URL failed validation: ${raw.slice(0, 96)}`,
    };
  }
}

export async function validateListingImageUrlsForCreate(
  urls: string[],
): Promise<{ ok: true } | { ok: false; message: string }> {
  const uniq = [...new Set(urls.map((u) => String(u).trim()).filter(Boolean))];
  for (const u of uniq) {
    const shape = validateListingImageUrlShape(u);
    if (!shape.ok) {
      return shape;
    }
  }
  for (const u of uniq) {
    const head = await validateListingImageUrlHead(u);
    if (!head.ok) {
      return head;
    }
  }
  return { ok: true };
}
