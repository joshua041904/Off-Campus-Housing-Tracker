#!/usr/bin/env node
/**
 * Hit POST .../insights/listing/:id/analyze N times; print verdict entropy (needs running gateway + listings + analytics + Ollama).
 * Usage:
 *   LISTING_ID=<uuid> RUNS=10 BASE_URL=https://192.168.64.244 ANALYTICS_QA_TLS_INSECURE=1 node scripts/analytics-qa/variability-harness.mjs
 *
 * Threshold enforcement (optional):
 *   ENFORCE_ANALYTICS_QA_THRESHOLDS=1 — exits non-zero if entropy violates temperature regime from last response _meta.
 */

import "./bootstrap-tls.mjs";
import { analyticsQaFetch, analyticsQaHeaders } from "./auth-headers.mjs";
import { bootstrapQaContext } from "./bootstrap.mjs";
import { verifyListingReachable } from "./preflight.mjs";

function jaccardSimilarity(a, b) {
  const A = new Set(
    a
      .toLowerCase()
      .split(/\W+/)
      .filter(Boolean),
  );
  const B = new Set(
    b
      .toLowerCase()
      .split(/\W+/)
      .filter(Boolean),
  );
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function computeVerdictEntropy(verdicts) {
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
  if (json?.verdict) return String(json.verdict);
  try {
    const inner = json?.intelligence_json ? JSON.parse(json.intelligence_json) : null;
    const v = inner?.intelligence?.verdict;
    if (v) return String(v);
  } catch {
    /* ignore */
  }
  return String(json?.analysis_text ?? "").slice(0, 400);
}

/** Temperature regime for thresholds: explicit EXPECT_ANALYTICS_TEMPERATURE overrides response _meta (QA runs). */
function enforcementTemperature(lastMeta) {
  const raw = process.env.EXPECT_ANALYTICS_TEMPERATURE;
  if (raw !== undefined && String(raw).trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0.85;
  }
  const fromMeta = Number(lastMeta.temperature);
  return Number.isFinite(fromMeta) ? fromMeta : 0.85;
}

function enforceEntropy(entropy, temperature) {
  if (!process.env.ENFORCE_ANALYTICS_QA_THRESHOLDS?.trim()) return;
  const temp = Number(temperature);
  const isDeterministic = Number.isFinite(temp) ? temp <= 0 : false;
  if (isDeterministic && entropy > 0.05) {
    console.error(`FAIL determinism: temperature=${temp} entropy=${entropy.toFixed(4)} > 0.05`);
    process.exit(1);
  }
  if (!isDeterministic && entropy < 0.25) {
    console.error(`FAIL variability: temperature=${temp} entropy=${entropy.toFixed(4)} < 0.25`);
    process.exit(1);
  }
}

async function main() {
  let listingId = process.env.LISTING_ID?.trim();
  const runs = Math.min(50, Math.max(2, Number(process.env.RUNS ?? "10")));
  const parallelism = Math.max(1, Math.min(runs, Number(process.env.VARIABILITY_CONCURRENCY ?? "2")));
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

  let lastMeta = {};

  const headers = await analyticsQaHeaders({ "Content-Type": "application/json" });

  const verdicts = new Array(runs);
  const metas = [];
  const runGapMs = Math.max(0, Number(process.env.ANALYTICS_QA_RUN_GAP_MS ?? "250"));
  const runOnce = async (idx) => {
    if (runGapMs) await new Promise((r) => setTimeout(r, Math.random() * runGapMs));
    const res = await analyticsQaFetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ audience: "renter", analysis_depth: "standard" }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`Run ${idx + 1} failed`, res.status, json);
      if (res.status === 401 && json?.code === "MISSING_TOKEN") {
        console.error(
          "[qa] JWT missing on request — check auth-client (BASE_URL, ANALYTICS_QA_EMAIL/PASSWORD) or set ANALYTICS_QA_BEARER_TOKEN.",
        );
      }
      process.exit(1);
    }
    verdicts[idx] = pickVerdict(json);
    metas[idx] = json._meta ?? {};
    console.log(`Run ${idx + 1}: fallback=${json._meta?.fallback_used} model=${json.model_used}`);
  };

  const workers = Array.from({ length: parallelism }, (_, workerIdx) =>
    (async () => {
      for (let i = workerIdx; i < runs; i += parallelism) {
        await runOnce(i);
      }
    })(),
  );
  await Promise.all(workers);
  for (let i = metas.length - 1; i >= 0; i--) {
    if (metas[i]) {
      lastMeta = metas[i];
      break;
    }
  }

  const entropy = computeVerdictEntropy(verdicts);
  console.log("\nVerdict entropy (higher = more variation):", entropy.toFixed(4));
  console.log("Sample verdict 1:", verdicts[0]?.slice(0, 120));
  console.log("Sample verdict 2:", verdicts[1]?.slice(0, 120));

  const temperature = enforcementTemperature(lastMeta);
  const metaTemp = Number(lastMeta.temperature);
  console.log("Enforcement temperature (EXPECT_ANALYTICS_TEMPERATURE or _meta):", temperature);
  if (
    process.env.EXPECT_ANALYTICS_TEMPERATURE !== undefined &&
    String(process.env.EXPECT_ANALYTICS_TEMPERATURE).trim() !== "" &&
    Number.isFinite(metaTemp) &&
    Math.abs(metaTemp - temperature) > 0.01
  ) {
    console.warn(
      "[qa] EXPECT_ANALYTICS_TEMPERATURE does not match response _meta.temperature — set ANALYTICS_LI_V2_TEMPERATURE on analytics-service to match or results are misleading.",
      { _meta_temperature: metaTemp, enforcement_temperature: temperature },
    );
  }
  console.log(
    `__QA_JSON__${JSON.stringify({
      script: "variability-harness",
      mode: process.env.QA_VARIABILITY_MODE || "variable",
      entropy,
      temperature,
    })}`,
  );
  enforceEntropy(entropy, temperature);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
