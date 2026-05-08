#!/usr/bin/env node
/**
 * Listing-feel with ~5k char description (no listing-service dependency).
 *   BASE_URL=https://off-campus-housing.test ANALYTICS_QA_TLS_INSECURE=1 node scripts/analytics-qa/large-input-test.mjs
 */

import "./bootstrap-tls.mjs";
import { analyticsQaFetch, analyticsQaHeaders } from "./auth-headers.mjs";

async function main() {
  const base = (process.env.BASE_URL ?? "http://127.0.0.1:4020").replace(/\/$/, "");
  const url = `${base}/api/analytics/insights/listing-feel`;

  const chunk =
    "Spacious unit near campus. Hardwood floors. In-unit laundry. Quiet building. ";
  let description = "";
  while (description.length < 5000) description += chunk;

  const headers = await analyticsQaHeaders({ "Content-Type": "application/json" });

  const t0 = Date.now();
  const res = await analyticsQaFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      title: "QA large-input synthetic listing",
      description,
      price_cents: 250000,
      audience: "renter",
      analysis_depth: "standard",
    }),
  });
  const json = await res.json().catch(() => ({}));
  const latency = Date.now() - t0;

  if (!res.ok) {
    console.error("HTTP", res.status, json);
    process.exit(1);
  }

  const text = String(json.analysis_text ?? "");
  const qaFast = process.env.ANALYTICS_QA_FAST_MODE === "1" || process.env.ANALYTICS_QA_FAST_MODE === "true";
  // Non-fast mode validates behavior under CPU-bound local Ollama; keep pass/fail threshold realistic and env-overridable.
  const latencyBudgetMs = Number(process.env.ANALYTICS_QA_LARGE_INPUT_MAX_MS ?? (qaFast ? "15000" : "90000"));
  if (latency >= latencyBudgetMs) {
    console.error(`FAIL latency ${latency}ms >= ${latencyBudgetMs}ms`);
    process.exit(1);
  }
  if (text.length < 200) {
    console.error(`FAIL response length ${text.length} < 200`);
    process.exit(1);
  }

  const lines = text.split("\n").filter((l) => l.trim().startsWith("- "));
  if (lines.length < 4) {
    console.error(`FAIL expected multiple bullet sections, got ${lines.length} lines`);
    process.exit(1);
  }

  const emptySection = lines.some((l) => /^-\s*\w+:\s*$/.test(l.trim()));
  if (emptySection) {
    console.error("FAIL empty bullet section detected");
    process.exit(1);
  }

  console.log("OK large-input latency_ms=", latency, "chars=", text.length, "bullets=", lines.length);
  if (json.generation_meta?.truncated === true) {
    console.log("(description was truncated server-side as expected for oversized prompts)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
