#!/usr/bin/env node
/**
 * Cheap slop / generic cliché detector on analyze responses.
 *   LISTING_ID=<uuid> BASE_URL=https://off-campus-housing.test ANALYTICS_QA_TLS_INSECURE=1 RUNS=15 node scripts/analytics-qa/hallucination-test.mjs
 */

import "./bootstrap-tls.mjs";
import { analyticsQaFetch, analyticsQaHeaders } from "./auth-headers.mjs";
import { bootstrapQaContext } from "./bootstrap.mjs";
import { verifyListingReachable } from "./preflight.mjs";

const SLOP =
  /(great opportunity|welcome home|won'?t last|don'?t miss|cozy vibes|perfect for anyone|simply put)/i;

function sampleVerdict(json) {
  if (json?.intelligence?.verdict) return String(json.intelligence.verdict);
  try {
    const inner = json?.intelligence_json ? JSON.parse(json.intelligence_json) : null;
    if (inner?.intelligence?.verdict) return String(inner.intelligence.verdict);
  } catch {
    /* ignore */
  }
  return String(json.analysis_text ?? "").slice(0, 600);
}

async function main() {
  let listingId = process.env.LISTING_ID?.trim();
  const runs = Math.min(40, Math.max(5, Number(process.env.RUNS ?? "15")));
  let base = (process.env.BASE_URL ?? "http://127.0.0.1:4020").replace(/\/$/, "");
  if (!listingId) {
    const boot = await bootstrapQaContext();
    listingId = boot.listingId;
    base = boot.baseUrl;
    if (!process.env.ANALYTICS_QA_BEARER_TOKEN) process.env.ANALYTICS_QA_BEARER_TOKEN = boot.token;
  }
  const url = `${base}/api/analytics/insights/listing/${listingId}/analyze`;

  if (process.env.ANALYTICS_QA_SKIP_LISTING_PROBE !== "1") {
    await verifyListingReachable(base, listingId);
  }

  let hits = 0;
  let latTotal = 0;
  const confidences = [];

  const headers = await analyticsQaHeaders({ "Content-Type": "application/json" });

  const runGapMs = Math.max(0, Number(process.env.ANALYTICS_QA_RUN_GAP_MS ?? "1000"));
  for (let i = 0; i < runs; i++) {
    if (i > 0 && runGapMs) await new Promise((r) => setTimeout(r, runGapMs));
    const t0 = Date.now();
    const res = await analyticsQaFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ audience: "renter", analysis_depth: "standard" }),
    });
    const json = await res.json().catch(() => ({}));
    latTotal += Date.now() - t0;
    if (!res.ok) {
      console.error("HTTP", res.status, json);
      process.exit(1);
    }
    const verdict = sampleVerdict(json);
    if (SLOP.test(verdict)) hits++;
    let c = json?.intelligence?.confidence_score;
    if (typeof c !== "number" || !Number.isFinite(c)) {
      try {
        const inner = json?.intelligence_json ? JSON.parse(json.intelligence_json) : null;
        c = inner?.intelligence?.confidence_score;
      } catch {
        /* ignore */
      }
    }
    if (typeof c === "number" && Number.isFinite(c)) confidences.push(c);
  }

  const rate = hits / runs;
  console.log("Hallucination slop hits:", hits, "/", runs, "=", (rate * 100).toFixed(1), "%");
  console.log("Avg latency ms:", (latTotal / runs).toFixed(1));
  let mean = NaN;
  if (confidences.length) {
    mean = confidences.reduce((a, b) => a + b, 0) / confidences.length;
    console.log("Confidence mean:", mean.toFixed(1), "(samples:", confidences.length, ")");
  } else {
    mean = 0;
    console.log("Confidence mean:", "0.0", "(samples: 0)");
  }
  console.log(
    `__QA_JSON__${JSON.stringify({
      script: "hallucination-test",
      hallucination_rate: rate,
      confidence_mean: mean,
      avg_latency_ms: latTotal / runs,
    })}`,
  );

  if (!process.env.ENFORCE_ANALYTICS_QA_THRESHOLDS?.trim()) return;

  const maxRate = Number(process.env.ANALYTICS_HALLUCINATION_MAX_FRAC ?? "0.1");
  if (rate > maxRate) {
    console.error(`FAIL hallucination rate ${rate} > ${maxRate}`);
    process.exit(1);
  }

  const avgMax = Number(process.env.ANALYTICS_HALLUCINATION_AVG_LATENCY_MAX_MS ?? "3500");
  if (latTotal / runs > avgMax) {
    console.error(`FAIL avg latency ${latTotal / runs} > ${avgMax}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
