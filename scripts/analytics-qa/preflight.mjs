/**
 * Fail fast when LISTING_ID is not visible through the edge (same signal analytics uses indirectly).
 */
import "./bootstrap-tls.mjs";
import { analyticsQaHeaders } from "./auth-headers.mjs";

export async function verifyListingReachable(baseRaw, listingId) {
  const base = String(baseRaw || "").replace(/\/$/, "");
  const urls = [`${base}/api/listings/${listingId}`, `${base}/api/listings/listings/${listingId}`];
  let res = null;
  let usedUrl = urls[0];
  for (const url of urls) {
    usedUrl = url;
    res = await fetch(url);
    if (res.status === 401) {
      const headers = await analyticsQaHeaders({});
      res = await fetch(url, { headers });
    }
    if (res.ok) return;
    if (res.status !== 404) break;
  }
  const body = await res.text().catch(() => "");
  if (!res.ok) {
    console.error(`[qa] GET ${usedUrl} → HTTP ${res.status}`);
    if (body.trim()) console.error(body.slice(0, 800));
    console.error(
      "[qa] Analyze calls analytics-service, which fetches this listing from listings-service. " +
        "A missing/wrong LISTING_ID yields HTTP 404 from analyze with an empty or sparse JSON body.",
    );
    throw new Error(`listing_not_reachable:${res.status}`);
  }
}
