#!/usr/bin/env node
/**
 * 50 concurrent POST analyze calls (latency spread + QA aggregates).
 *   LISTING_ID=<uuid> BASE_URL=https://off-campus-housing.test ANALYTICS_QA_TLS_INSECURE=1 node scripts/analytics-qa/stress-50.mjs
 *
 * Thresholds with ENFORCE_ANALYTICS_QA_THRESHOLDS=1:
 *   ANALYTICS_STRESS_P95_MAX_MS (default 5000)
 *   ANALYTICS_STRESS_ERROR_MAX_FRAC (default 0.02)
 */

import "./bootstrap-tls.mjs";
import { analyticsQaFetch, analyticsQaHeaders } from "./auth-headers.mjs";
import { bootstrapQaContext } from "./bootstrap.mjs";
import { verifyListingReachable } from "./preflight.mjs";

function jaccardSimilarity(a, b) {
  const A = new Set(a.toLowerCase().split(/\W+/).filter(Boolean));
  const B = new Set(b.toLowerCase().split(/\W+/).filter(Boolean));
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function verdictEntropy(verdicts) {
  if (verdicts.length < 2) return 0;
  let totalSimilarity = 0;
  let comparisons = 0;
  for (let i = 0; i < verdicts.length; i++) {
    for (let j = i + 1; j < verdicts.length; j++) {
      totalSimilarity += jaccardSimilarity(verdicts[i], verdicts[j]);
      comparisons++;
    }
  }
  const avgSimilarity = comparisons ? totalSimilarity / comparisons : 1;
  return 1 - avgSimilarity;
}

function pickVerdict(json) {
  if (json?.intelligence?.verdict) return String(json.intelligence.verdict);
  try {
    const inner = json?.intelligence_json ? JSON.parse(json.intelligence_json) : null;
    const v = inner?.intelligence?.verdict;
    if (v) return String(v);
  } catch {
    /* ignore */
  }
  return String(json?.analysis_text ?? "").slice(0, 400);
}

function isFallback(json, ok) {
  if (!ok) return true;
  const m = String(json?.model_used ?? "");
  return (
    m.includes("fallback") ||
    m === "none" ||
    m === "rule-based-fallback" ||
    json?._meta?.fallback_used === true
  );
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
  const url = `${base}/api/analytics/insights/listing/${listingId}/analyze`;
  const concurrency = Math.max(1, Number(process.env.CONCURRENCY ?? "50"));
  const parallelism = Math.max(1, Math.min(concurrency, Number(process.env.STRESS_PARALLELISM ?? "5")));

  if (process.env.ANALYTICS_QA_SKIP_LISTING_PROBE !== "1") {
    await verifyListingReachable(base, listingId);
  }

  const headers = await analyticsQaHeaders({ "Content-Type": "application/json" });

  const staggerMs = Math.max(0, Number(process.env.ANALYTICS_QA_STRESS_STAGGER_MS ?? "500"));
  const out = new Array(concurrency);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= concurrency) return;
      if (staggerMs) await new Promise((r) => setTimeout(r, Math.random() * staggerMs));
      const t0 = Date.now();
      const res = await analyticsQaFetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ audience: "landlord", analysis_depth: "standard" }),
      });
      const json = await res.json().catch(() => ({}));
      const ms = Date.now() - t0;
      out[i] = { i, ms, ok: res.ok, status: res.status, json };
    }
  };
  await Promise.all(Array.from({ length: parallelism }, () => worker()));
  const latencies = out.map((o) => o.ms).sort((a, b) => a - b);
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const p95Idx = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
  const p95 = latencies[p95Idx] ?? latencies.at(-1);
  const failed = out.filter((o) => !o.ok).length;
  const errorFrac = failed / out.length;
  const fallbackCount = out.filter((o) => isFallback(o.json, o.ok)).length;
  const fallbackFrac = fallbackCount / out.length;
  const verdicts = out.filter((o) => o.ok).map((o) => pickVerdict(o.json));
  const entropyMean = verdictEntropy(verdicts);

  console.log("Results:", failed, "failed /", out.length);
  console.log("Latency ms min/p50/p95/max:", latencies[0], latencies[Math.floor(latencies.length / 2)], p95, latencies.at(-1));
  console.log("Latency avg:", avg.toFixed(1));
  console.log("Error rate:", (errorFrac * 100).toFixed(2), "%");
  console.log("Fallback rate:", (fallbackFrac * 100).toFixed(2), "%");
  console.log("Verdict entropy (batch):", entropyMean.toFixed(4));
  console.log(
    `__QA_JSON__${JSON.stringify({
      script: "stress-50",
      avg_latency_ms: avg,
      p95_latency_ms: p95,
      error_rate: errorFrac,
      fallback_rate: fallbackFrac,
      entropy: entropyMean,
    })}`,
  );

  if (!process.env.ENFORCE_ANALYTICS_QA_THRESHOLDS?.trim()) return;

  const p95Max = Number(process.env.ANALYTICS_STRESS_P95_MAX_MS ?? "5000");
  const avgMax = Number(process.env.ANALYTICS_STRESS_AVG_MAX_MS ?? "2500");
  const errMax = Number(process.env.ANALYTICS_STRESS_ERROR_MAX_FRAC ?? "0.02");
  const fbMax = Number(process.env.ANALYTICS_STRESS_FALLBACK_MAX_FRAC ?? "0.05");
  const entMin = Number(process.env.ANALYTICS_STRESS_ENTROPY_MIN ?? "0.25");

  if (avg > avgMax) {
    console.error(`FAIL avg latency ${avg.toFixed(1)}ms > ${avgMax}ms`);
    process.exit(1);
  }
  if (p95 > p95Max) {
    console.error(`FAIL p95 ${p95}ms > ${p95Max}ms`);
    process.exit(1);
  }
  if (errorFrac > errMax) {
    console.error(`FAIL error rate ${errorFrac} > ${errMax}`);
    process.exit(1);
  }
  if (fallbackFrac > fbMax) {
    console.error(`FAIL fallback rate ${fallbackFrac} > ${fbMax}`);
    process.exit(1);
  }
  if (entropyMean < entMin) {
    console.error(`FAIL batch entropy ${entropyMean.toFixed(4)} < ${entMin}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
