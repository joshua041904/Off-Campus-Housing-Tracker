import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const LISTING_DETAIL_API = /^\/api\/listings\/listings\/([0-9a-fA-F-]{36})\/?$/;

/**
 * Browsers that open a listing JSON API URL (e.g. copied from devtools) should land on the real listing page.
 * Skip when the client clearly wants JSON only (fetch / API tools).
 */
function shouldRedirectBrowserListingApiToPage(request: NextRequest): boolean {
  const accept = request.headers.get("accept") || "";
  const hasHtml = /\btext\/html\b/i.test(accept);
  const jsonOnly = /\bapplication\/json\b/i.test(accept) && !hasHtml;
  if (jsonOnly) return false;
  if (request.headers.get("sec-fetch-mode") === "navigate") return true;
  if (request.headers.get("sec-fetch-dest") === "document") return true;
  if (hasHtml) return true;
  return false;
}

export function middleware(request: NextRequest) {
  if (request.method !== "GET") return NextResponse.next();
  const path = request.nextUrl.pathname;
  const m = path.match(LISTING_DETAIL_API);
  if (!m) return NextResponse.next();
  if (!shouldRedirectBrowserListingApiToPage(request)) return NextResponse.next();
  const url = request.nextUrl.clone();
  url.pathname = `/listings/${m[1]}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/api/listings/listings/:path*"],
};
