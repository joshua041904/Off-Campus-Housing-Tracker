#!/usr/bin/env node
/**
 * Compare quick vs deep vs expanded listing description lengths on analyze endpoint.
 *   BASE_URL=https://off-campus-housing.test ANALYTICS_QA_TLS_INSECURE=1 LISTING_ID=... node scripts/analytics-qa/depth-sensitivity.mjs
 * If only LISTING_ID set, same listing is used with synthetic description overrides via listing-feel body is NOT supported here —
 * use two listing IDs or run twice after editing listing in DB.
 */

import "./bootstrap-tls.mjs";
import { analyticsQaFetch, analyticsQaHeaders } from "./auth-headers.mjs";
import { bootstrapQaContext } from "./bootstrap.mjs";
import { verifyListingReachable } from "./preflight.mjs";

async function analyze(base, listingId, depth) {
  const url = `${base}/api/analytics/insights/listing/${listingId}/analyze`;
  const headers = await analyticsQaHeaders({ "Content-Type": "application/json" });
  const res = await analyticsQaFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ audience: "renter", analysis_depth: depth }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status} ${JSON.stringify(json)}`);
  const text = String(json.analysis_text ?? "");
  return { words: text.split(/\s+/).filter(Boolean).length, json };
}

async function main() {
  let listingId = process.env.LISTING_ID?.trim();
  let base = (process.env.BASE_URL ?? "http://127.0.0.1:4020").replace(/\/$/, "");
  if (!listingId) {
    const boot = await bootstrapQaContext();
    listingId = boot.listingId;
    base = boot.baseUrl;
    if (!process.env.ANALYTICS_QA_BEARER_TOKEN) process.env.ANALYTICS_QA_BEARER_TOKEN = boot.token;
  }

  if (process.env.ANALYTICS_QA_SKIP_LISTING_PROBE !== "1") {
    await verifyListingReachable(base, listingId);
  }

  const quick = await analyze(base, listingId, "quick");
  const deep = await analyze(base, listingId, "deep");

  console.log("Quick output words:", quick.words);
  console.log("Deep output words:", deep.words);
  if (deep.words <= quick.words) {
    console.warn("WARN: deep <= quick word count (depth mapping or model cap worth checking)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
