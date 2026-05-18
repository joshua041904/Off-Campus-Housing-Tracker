/**
 * Listing media rows may store absolute https URLs (S3/CDN) or same-origin paths
 * returned by media-service (`/api/media/public/...` signed inline reads).
 */
export function isAcceptedListingImageUploadUrl(url: string | null | undefined): boolean {
  const u = String(url ?? "").trim();
  if (!u) return false;
  if (u.startsWith("/api/media/") || u.startsWith("/media/")) return true;
  if (/^https:\/\//i.test(u)) return true;
  try {
    const parsed = new URL(u);
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]")
    ) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
