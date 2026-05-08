import { createHash, randomUUID } from "node:crypto";
import { TraceFlags, trace } from "@opentelemetry/api";
import client from "prom-client";
import { acquireLockWithToken, releaseLockWithToken, register } from "@common/utils";
import { pool } from "./db.js";
import {
  analyticsGenerationFallbackTotal,
  analyticsGenerationLatencyMs,
  analyticsGenerationRequestsTotal,
  analyticsGenerationTokensEstimated,
} from "./intelligence/analyticsGenerationMetrics.js";
import { appendAnalyticsDiagnostic } from "./intelligence/diagnostics.js";
import { isListingIntelligenceV2Enabled, runListingIntelligenceV2 } from "./intelligence/listingIntelligenceV2.js";
import { listingFeelShortCircuitTail, runStage, stageSkipped } from "./intelligence/pipeline-tracing.js";
import { isAIFailure } from "./aiFailure.js";
import { applyDevFastTokenCap, clampNumPredict } from "./intelligence/generationLimits.js";
import { getOllamaGenerateTimeoutMs } from "./intelligence/ollamaTimeoutBudget.js";
import { maybeInjectAiChaos } from "./aiChaos.js";
import { ollamaKeepAliveRequestField } from "./intelligence/ollamaKeepAlive.js";
import type { ListingIntelligenceGenerationMeta } from "./intelligence/types.js";
import { getPromptVersion, getRuntimeMode, getRuntimeModel } from "./intelligence/aiControlPlaneRuntime.js";

function ollamaBaseUrl(): string {
  return (process.env.OLLAMA_BASE_URL || "").replace(/\/$/, "");
}

function ollamaModel(): string {
  // Keep default aligned with infra/k8s/base/config/app-config.yaml (tag matters — bare "llama3.2" often missing locally).
  return getRuntimeModel() || process.env.OLLAMA_MODEL || "llama3.2:1b";
}

/** Cache rows from older builds or manual DB edits should not permanently mask a working Ollama. */
function isNonLlmListingFeelCacheModel(model: unknown): boolean {
  const m = String(model ?? "").toLowerCase();
  return m === "rule-based-fallback" || m === "none";
}

function ollamaRequestTimeoutMs(): number {
  return getOllamaGenerateTimeoutMs();
}

/** Total fetch attempts for listing-feel (loop uses `attempt <= n`; must be ≥ 1). */
function ollamaMaxRetries(): number {
  const qaFast = process.env.ANALYTICS_QA_FAST_MODE === "1" || process.env.ANALYTICS_QA_FAST_MODE === "true";
  if (qaFast) return 1;
  const devFast = process.env.ANALYTICS_DEV_FAST_MODE === "1" || process.env.ANALYTICS_DEV_FAST_MODE === "true";
  if (devFast) return 1;
  // One long attempt is better than multiple short timeouts for local model cold-start paths.
  const n = Number(process.env.ANALYTICS_OLLAMA_RETRIES || "1");
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 1;
}

/** Cap output tokens for listing-feel (CPU time scales ~linearly with num_predict; max see generationLimits). */
function listingFeelNumPredict(): number {
  const n = Number(process.env.ANALYTICS_LISTING_FEEL_NUM_PREDICT || "700");
  const base = clampNumPredict(Number.isFinite(n) ? n : 700);
  const runtimeMode = getRuntimeMode();
  if (runtimeMode === "degraded") return Math.min(240, applyDevFastTokenCap(base));
  return applyDevFastTokenCap(base);
}

function listingFeelTemperature(): number {
  const n = Number(process.env.ANALYTICS_LISTING_FEEL_TEMPERATURE || "0.45");
  if (!Number.isFinite(n)) return 0.45;
  return Math.min(2, Math.max(0, n));
}

function listingFeelNumCtx(): number {
  const n = Number(process.env.ANALYTICS_LISTING_FEEL_NUM_CTX || "2048");
  if (!Number.isFinite(n)) return 2048;
  return Math.min(8192, Math.max(256, Math.floor(n)));
}

function listingFeelTopP(): number {
  const n = Number(process.env.ANALYTICS_LISTING_FEEL_TOP_P || "0.9");
  if (!Number.isFinite(n)) return 0.9;
  return Math.min(1, Math.max(0.05, n));
}

function listingFeelRepeatPenalty(): number {
  const n = Number(process.env.ANALYTICS_LISTING_FEEL_REPEAT_PENALTY || "1.15");
  if (!Number.isFinite(n)) return 1.15;
  return Math.min(2, Math.max(1, n));
}

/** Heuristic 0–1: bullet structure, length band, anti-slop. */
export function computeListingFeelQualityScore(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  const bullets = t.split("\n").filter((line) => /^- /.test(line.trim()));
  const n = bullets.length;
  let s = 0.2;
  if (n >= 6 && n <= 12) s += 0.4;
  else if (n >= 4 && n <= 14) s += 0.2;
  const len = t.length;
  if (len >= 140 && len <= 8000) s += 0.35;
  else if (len >= 80) s += 0.15;
  const slop =
    /(great opportunity|welcome home|won't last|don'?t miss|cozy vibes|perfect for anyone|simply put|overall,? this)/i;
  if (slop.test(t)) s -= 0.3;
  return Math.max(0, Math.min(1, Math.round(s * 100) / 100));
}

/** Strip common Markdown / nested-bullet habits so the UI stays plain-text. */
function normalizeListingFeelOutput(raw: string): string {
  let s = raw.replace(/\r\n/g, "\n").trim();
  s = s.replace(/^(?:.{0,160}?(?:here are|below (?:is|are)|following (?:is|are))[^\n]*\n)+/i, "");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/\*([^*]+)\*/g, "$1");
  const lines = s
    .split("\n")
    .map((line) => {
      let t = line.trim();
      if (!t) return "";
      t = t.replace(/^#{1,6}\s+/, "");
      t = t.replace(/^\t+/, "");
      t = t.replace(/^[\u2022\u2023\u2043\u2219\u25CF\u00B7]\s*/, "- ");
      t = t.replace(/^\+\s+/, "- ");
      if (t.startsWith("-")) {
        t = t.replace(/^-\s*/, "- ");
      } else {
        t = `- ${t}`;
      }
      return t;
    })
    .filter(Boolean);
  return dedupeListingFeelBulletLines(lines).join("\n").trim();
}

/** Drop exact duplicate lines and repeated "Topic - detail" stems (e.g. two "Lease traps - …" lines). */
function dedupeListingFeelBulletLines(lines: string[]): string[] {
  const exactSeen = new Set<string>();
  const stemSeen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const norm = line.trim().toLowerCase();
    if (exactSeen.has(norm)) continue;
    exactSeen.add(norm);
    const body = line.replace(/^-\s*/, "").trim();
    const stemMatch = body.match(/^(.{3,40}?)\s-\s\S/);
    if (stemMatch) {
      const stem = stemMatch[1]!.trim().toLowerCase();
      if (stem.length >= 4) {
        if (stemSeen.has(stem)) continue;
        stemSeen.add(stem);
      }
    }
    out.push(line);
  }
  return out;
}

const listingFeelFormatRules = `Output format (mandatory):
Respond with 6 to 12 lines only. Each line starts with "- " (ASCII hyphen and space) and is one complete point. No blank lines. Keep bullets tight (prefer shorter lines over padding).

Hard rules: plain text only. No Markdown (no ** asterisks **, no # headings, no backticks). Do not use unicode bullet characters. Do not use nested bullets, tab-indented lines, or lines starting with "+".

No preamble or title line: do not write phrases like "Here are" or "Below is"; start immediately with the first "- " line.

Each bullet must be a distinct theme: never repeat the same topic label twice (e.g. only one line about lease terms / traps). If two risks overlap, merge them into one sharper bullet.

Tone: analytical, not friendly. Avoid filler and generic leasing clichés.`;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Serialize Ollama HTTP calls — parallel /api/generate from warmup + listing-feel caused 5xx on Colima. */
let ollamaSerialChain: Promise<unknown> = Promise.resolve();
function withOllamaSerial<T>(fn: () => Promise<T>): Promise<T> {
  const next = ollamaSerialChain.then(fn, fn);
  ollamaSerialChain = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

const ollamaLatencyMs = new client.Histogram({
  name: "analytics_ollama_latency_ms",
  help: "Latency in ms of successful Ollama /api/generate responses",
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
  registers: [register],
  enableExemplars: true,
});
const listingFeelQualityHist = new client.Histogram({
  name: "analytics_listing_feel_quality_score",
  help: "Heuristic 0–1 listing-feel output quality (bullets, length, anti-slop)",
  buckets: [0.2, 0.4, 0.6, 0.8, 1],
  registers: [register],
  enableExemplars: true,
});
const ollamaFailuresTotal = new client.Counter({
  name: "analytics_ollama_failures_total",
  help: "Ollama upstream failures resolved via rule-based fallback",
  registers: [register],
});
for (const m of [ollamaLatencyMs, listingFeelQualityHist, ollamaFailuresTotal]) {
  try {
    register.registerMetric(m);
  } catch {
    /* already registered */
  }
}

function otelTraceExemplar(): Record<string, string> | undefined {
  const sc = trace.getActiveSpan()?.spanContext();
  if (!sc?.traceId || sc.traceId === "00000000000000000000000000000000") return undefined;
  if ((sc.traceFlags & TraceFlags.SAMPLED) !== TraceFlags.SAMPLED) return undefined;
  return { trace_id: sc.traceId };
}

/** prom-client Histogram supports exemplars at runtime; TS defs omit observeWithExemplar. */
type HistogramExemplar = {
  observeWithExemplar(o: { labels: Record<string, string>; value: number; exemplarLabels: Record<string, string> }): void;
  observe(labels: Record<string, string>, value: number): void;
  observe(value: number): void;
};

function observeWithTraceExemplar(h: client.Histogram, value: number, labels: Record<string, string> = {}): void {
  const ex = otelTraceExemplar();
  const hi = h as unknown as HistogramExemplar;
  const lbl = Object.keys(labels).length ? labels : {};
  if (ex) {
    hi.observeWithExemplar({ labels: lbl, value, exemplarLabels: ex });
    return;
  }
  // prom-client: when `enableExemplars` is true, `Histogram.observe` is `observeWithExemplar` (single options
  // object). A two-arg call `observe({}, value)` is parsed as one arg, so `value` is lost and observe throws.
  if ((h as { enableExemplars?: boolean }).enableExemplars === true) {
    hi.observeWithExemplar({ labels: lbl, value, exemplarLabels: {} });
    return;
  }
  if (Object.keys(labels).length) hi.observe(labels, value);
  else hi.observe(value);
}

function listingFeelSkipCache(): boolean {
  if (!isListingIntelligenceV2Enabled()) return false;
  return process.env.ANALYTICS_LI_V2_BYPASS_CACHE !== "0";
}

function listingFeelCacheVariant(input: { analysis_depth?: unknown }): string {
  if (!isListingIntelligenceV2Enabled()) return "li-v1";
  const d = String(input.analysis_depth || "standard").toLowerCase();
  if (d === "quick" || d === "deep") return `li-v2|${d}`;
  return "li-v2|standard";
}

function noSilentFallback(): boolean {
  return process.env.ANALYTICS_LISTING_FEEL_NO_SILENT_FALLBACK === "1";
}

/** Omit `AbortSignal` on `/api/generate` fetch (isolates timeout vs network). */
function listingFeelFetchNoAbort(): boolean {
  return process.env.ANALYTICS_LISTING_FEEL_FETCH_NO_ABORT === "1" || process.env.ANALYTICS_LISTING_FEEL_FETCH_NO_ABORT === "true";
}

/** Do not return rule-based bullet stub when Ollama fails — throw so HTTP can surface 502. */
function listingFeelNoRuleFallback(): boolean {
  return (
    process.env.ANALYTICS_LISTING_FEEL_NO_RULE_FALLBACK === "1" ||
    process.env.ANALYTICS_LISTING_FEEL_NO_RULE_FALLBACK === "true" ||
    process.env.ANALYTICS_LISTING_FEEL_NO_DEGRADED_MASK === "1" ||
    process.env.ANALYTICS_LISTING_FEEL_NO_DEGRADED_MASK === "true"
  );
}

function listingFeelSingleAttempt(): boolean {
  return (
    listingFeelFetchNoAbort() ||
    process.env.ANALYTICS_LISTING_FEEL_SINGLE_ATTEMPT === "1" ||
    process.env.ANALYTICS_LISTING_FEEL_SINGLE_ATTEMPT === "true" ||
    listingFeelNoRuleFallback()
  );
}

function contentKey(
  title: string,
  description: string,
  priceCents: number,
  audience: string,
  variant: string,
): string {
  return createHash("sha256").update(`${title}|${description}|${priceCents}|${audience}|${variant}`).digest("hex");
}

function ruleBasedListingFeel(audience: "landlord" | "renter"): {
  analysis_text: string;
  model_used: string;
  quality_score: number;
} {
  if (audience === "landlord") {
    const analysis_text =
      "- Price vs market (rule-based fallback — Ollama unavailable)\n- Condition and maintenance signals from the description\n- Lease terms and liability items to clarify\n- Presentation and disclosure gaps\n- Tenant-fit and vacancy-risk notes";
    return {
      analysis_text,
      model_used: "rule-based-fallback",
      quality_score: computeListingFeelQualityScore(analysis_text),
    };
  }
  const analysis_text =
    "- Value vs asking (rule-based fallback — Ollama unavailable)\n- Commute and neighborhood fit from stated cues\n- Red flags: fees, restrictions, ambiguous utilities\n- Questions for the landlord before applying\n- Next steps: tour, references, comparable listings";
  return {
    analysis_text,
    model_used: "rule-based-fallback",
    quality_score: computeListingFeelQualityScore(analysis_text),
  };
}

export async function analyzeListingFeelText(input: {
  title: string;
  description: string;
  price_cents: number;
  audience: string;
  analysis_depth?: unknown;
  /** Optional structured facts for Listing Intelligence v2 (amenities, lease window, geo). */
  listing_facts?: Record<string, unknown>;
  listing_id?: string | null;
}): Promise<{
  analysis_text: string;
  model_used: string;
  quality_score: number;
  intelligence_json?: string;
  confidence_explanation?: string;
  generation_meta?: ListingIntelligenceGenerationMeta;
}> {
  const audience = (input.audience || "renter").toLowerCase() === "landlord" ? "landlord" : "renter";
  const variant = listingFeelCacheVariant(input);
  const hash = contentKey(input.title, input.description, input.price_cents, audience, variant);
  return runStage("analytics.intelligence.pipeline", async () => analyzeListingFeelTextPipeline(input, audience, variant, hash));
}

type ListingFeelResult = {
  analysis_text: string;
  model_used: string;
  quality_score: number;
  intelligence_json?: string;
  confidence_explanation?: string;
  generation_meta?: ListingIntelligenceGenerationMeta;
};

async function analyzeListingFeelTextPipeline(
  input: {
    title: string;
    description: string;
    price_cents: number;
    audience: string;
    analysis_depth?: unknown;
    listing_facts?: Record<string, unknown>;
    listing_id?: string | null;
  },
  audience: "landlord" | "renter",
  variant: string,
  hash: string,
): Promise<ListingFeelResult> {
  const cacheLookup = await runStage("analytics.cache.lookup", async (span) => {
    if (listingFeelSkipCache()) {
      span.setAttribute("och.cache", "policy_skip");
      return { kind: "miss" as const };
    }
    try {
      const cached = await pool.query(
        `SELECT analysis_text, model FROM analytics.listing_feel_cache WHERE content_hash = $1 AND audience = $2 ORDER BY created_at DESC LIMIT 1`,
        [hash, audience],
      );
      if (cached.rows[0] && !isNonLlmListingFeelCacheModel(cached.rows[0].model)) {
        const analysis_text = String(cached.rows[0].analysis_text);
        const model_used = String(cached.rows[0].model);
        span.setAttribute("och.cache", "hit");
        const quality_score = computeListingFeelQualityScore(analysis_text);
        return { kind: "hit" as const, analysis_text, model_used, quality_score };
      }
      span.setAttribute("och.cache", "miss");
    } catch (e) {
      console.error("[listing-feel] cache read failed (continuing without cache)", e);
    }
    return { kind: "miss" as const };
  });

  if (cacheLookup.kind === "hit") {
    return listingFeelShortCircuitTail("cache_hit", {
      analysis_text: cacheLookup.analysis_text,
      model_used: cacheLookup.model_used,
      quality_score: cacheLookup.quality_score,
    });
  }

  if (!ollamaBaseUrl()) {
    console.warn("[listing-feel] ANALYTICS_MODE=NONE OLLAMA_BASE_URL unset");
    appendAnalyticsDiagnostic({
      ts: new Date().toISOString(),
      analytics_mode: "NONE",
      fallback_used: true,
      listing_id: input.listing_id ?? null,
      error: "OLLAMA_BASE_URL unset",
    });
    if (process.env.ANALYTICS_LISTING_FEEL_STRICT_OLLAMA === "1" || noSilentFallback()) {
      throw new Error("[listing-feel] ANALYTICS_MODE=NONE OLLAMA_BASE_URL unset");
    }
    const analysis_text =
      audience === "landlord"
        ? "LLM disabled (set OLLAMA_BASE_URL). Summarize: highlight price vs market, condition, and lease terms."
        : "LLM disabled (set OLLAMA_BASE_URL). Summarize: value, commute fit, and questions to ask the landlord.";
    const quality_score = computeListingFeelQualityScore(analysis_text);
    return listingFeelShortCircuitTail("no_ollama", { analysis_text, model_used: "none", quality_score });
  }

  if (getRuntimeMode() === "legacy") {
    const legacy = ruleBasedListingFeel(audience);
    return listingFeelShortCircuitTail("runtime_legacy_mode", legacy);
  }

  return runStage("analytics.session.lock", async (lockSpan) => {
    const lockKey = `och:listing-feel:${hash}:${audience}`;
    const token = randomUUID();
    let gotLock = await acquireLockWithToken(lockKey, token, 45_000);
    lockSpan.setAttribute("och.lock_acquired", gotLock);
    if (!gotLock) {
      await new Promise((r) => setTimeout(r, 400));
      if (!listingFeelSkipCache()) {
        try {
          const retry = await pool.query(
            `SELECT analysis_text, model FROM analytics.listing_feel_cache WHERE content_hash = $1 AND audience = $2 ORDER BY created_at DESC LIMIT 1`,
            [hash, audience],
          );
          if (retry.rows[0] && !isNonLlmListingFeelCacheModel(retry.rows[0].model)) {
            const analysis_text = String(retry.rows[0].analysis_text);
            const model_used = String(retry.rows[0].model);
            const quality_score = computeListingFeelQualityScore(analysis_text);
            return listingFeelShortCircuitTail("cache_hit_after_lock_miss", {
              analysis_text,
              model_used,
              quality_score,
            });
          }
        } catch (e) {
          console.error("[listing-feel] cache retry read failed after lock miss", e);
        }
      }
    }

    try {
      return await runStage("analytics.routing.model_path", async (routeSpan) => {
        routeSpan.setAttribute("och.li_v2_enabled", isListingIntelligenceV2Enabled());
        return await runStage("analytics.model.generate", async () => {
          const priceUsd = (input.price_cents / 100).toFixed(2);
    const titleRaw = String(input.title || "");
    const descRaw = String(input.description || "");
    const title = titleRaw.slice(0, 1200);
    const description = descRaw.slice(0, 4000);
    const descriptionForV2 = descRaw;

    if (isListingIntelligenceV2Enabled()) {
      try {
        const v2 = await runStage("analytics.upstream.ollama_http", async () =>
          runListingIntelligenceV2({
            baseUrl: ollamaBaseUrl(),
            primaryModel: ollamaModel(),
            audience,
            title,
            description: descriptionForV2,
            priceUsd,
            analysis_depth: input.analysis_depth,
            listingFacts: input.listing_facts,
            listing_id: input.listing_id ?? null,
            timeoutMs: ollamaRequestTimeoutMs(),
            fetchOnce: (inputUrl, init) => withOllamaSerial(() => fetch(inputUrl, init)),
          }),
        );
        if (v2) {
          observeWithTraceExemplar(ollamaLatencyMs, v2.duration_ms);
          observeWithTraceExemplar(listingFeelQualityHist, computeListingFeelQualityScore(v2.analysis_text));
          await runStage("analytics.model.postprocess", async (pp) => {
            stageSkipped(pp, "li_v2");
          });
          const quality_score = await runStage("analytics.quality.compute", async () =>
            computeListingFeelQualityScore(v2.analysis_text),
          );
          let intelligence_json: string;
          try {
            intelligence_json = JSON.stringify({
              intelligence: v2.intelligence,
              meta: v2.meta,
              generation_meta: v2.generation_meta,
            });
          } catch (serErr) {
            console.warn("[listing-feel] li-v2 JSON stringify failed", serErr);
            intelligence_json = JSON.stringify({
              intelligence: null,
              meta: v2.meta,
              generation_meta: v2.generation_meta,
            });
          }
          await runStage("analytics.persistence.cache_write", async () => {
            if (!listingFeelSkipCache()) {
              try {
                await pool.query(
                  `INSERT INTO analytics.listing_feel_cache (content_hash, audience, model, analysis_text) VALUES ($1, $2, $3, $4)
           ON CONFLICT (content_hash, audience) DO NOTHING`,
                  [hash, audience, `${ollamaModel()}+li-v2`, v2.analysis_text],
                );
              } catch (dbErr) {
                console.warn("[listing-feel] li-v2 cache insert skipped", (dbErr as Error)?.message || dbErr);
              }
            }
          });
          return {
            analysis_text: v2.analysis_text,
            model_used: `${ollamaModel()}+li-v2`,
            quality_score,
            intelligence_json,
            confidence_explanation: v2.meta.confidence_explanation,
            generation_meta: v2.generation_meta,
          };
        }
      } catch (v2Err) {
        if (isAIFailure(v2Err)) throw v2Err;
        console.error("[listing-feel] listing intelligence v2 failed; falling back to legacy generate", v2Err);
        appendAnalyticsDiagnostic({
          ts: new Date().toISOString(),
          listing_id: input.listing_id ?? null,
          analytics_mode: "LLM",
          fallback_used: true,
          error: String((v2Err as Error)?.message || v2Err).slice(0, 2000),
        });
      }
      analyticsGenerationFallbackTotal.inc({ reason: "listing_intelligence_v2" });
    }

    // /api/generate (not chat) keeps Colima CPU paths predictable; instructions bias toward tradeoffs vs generic bullets.
    const renterBlock = `You are a senior rental market analyst.

Analyze this listing like a serious renter comparing multiple options.

Output 6–12 bullet points covering (one bullet each, no overlap): pricing vs comps, value drivers, risks/red flags, information gaps, lease or fee gotchas, negotiation or next-step leverage.

Be analytical, not friendly.
Avoid filler.
No markdown.
Each line must start with "- ".
Each bullet: 2–4 sentences when the listing warrants detail; finish every bullet (no trailing cut-offs).

${listingFeelFormatRules}`;

    const landlordBlock = `You are a rental portfolio strategist.

Analyze this listing from the landlord perspective.

Output 6–12 bullet points covering (one bullet each, no overlap): competitive positioning, strengths vs alternatives, conversion weaknesses, pricing risk, presentation gaps, concrete improvements to improve inquiries.

Be direct and strategic.
No fluff.
Each line must start with "- ".
Each bullet: 2–4 sentences when warranted; finish every bullet (no trailing cut-offs).

${listingFeelFormatRules}`;

    const facts = `Listing title: ${titleRaw.slice(0, 800)}
Description: ${description}
Asking (USD / month): ${priceUsd}`;

    const promptVersion = getPromptVersion();
    const promptEnvelope = `Prompt version: ${promptVersion}\nRuntime mode: ${getRuntimeMode()}`;
    const prompt =
      audience === "landlord"
        ? `${promptEnvelope}\n\n${landlordBlock}\n\n${facts}`
        : `${promptEnvelope}\n\n${renterBlock}\n\n${facts}`;

    const t0 = Date.now();
    analyticsGenerationRequestsTotal.inc({ path: "listing_feel_generate" });
    const timeoutMs = ollamaRequestTimeoutMs();
    const retries = listingFeelSingleAttempt() ? 1 : ollamaMaxRetries();
    const fetchNoAbort = listingFeelFetchNoAbort();
    console.log(
      "[listing-feel] OLLAMA_TIMEOUT_MS",
      timeoutMs,
      "fetch_no_abort",
      fetchNoAbort,
      "retries",
      retries,
      "base",
      ollamaBaseUrl(),
    );
    let body: { response?: string } | null = null;
    let lastOllamaDiag: { status?: number; snippet?: string; transport?: string } = {};
    for (let attempt = 1; attempt <= retries; attempt++) {
      let res: Response | null = null;
      try {
        await maybeInjectAiChaos("listing_feel_generate");
        const genUrl = `${ollamaBaseUrl()}/api/generate`;
        const init: RequestInit = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: ollamaModel(),
            prompt,
            stream: false,
            keep_alive: ollamaKeepAliveRequestField(),
            options: {
              num_ctx: listingFeelNumCtx(),
              num_predict: listingFeelNumPredict(),
              temperature: listingFeelTemperature(),
              top_p: listingFeelTopP(),
              repeat_penalty: listingFeelRepeatPenalty(),
            },
          }),
        };
        if (!fetchNoAbort) {
          init.signal = AbortSignal.timeout(timeoutMs);
        }
        res = await runStage("analytics.upstream.ollama_http", async () => withOllamaSerial(() => fetch(genUrl, init)));
      } catch (e) {
        const name = e instanceof Error ? e.name : "";
        const msg = e instanceof Error ? e.message : String(e);
        console.error("OLLAMA_FETCH_ERROR", name, msg);
        lastOllamaDiag = {
          transport: e instanceof Error ? e.message : String(e),
        };
        res = null;
      }
      if (res) {
        const rawText = await res.text().catch(() => "");
        let parsed: { response?: string; error?: string } = {};
        try {
          parsed = rawText ? (JSON.parse(rawText) as { response?: string; error?: string }) : {};
        } catch {
          console.error("OLLAMA_HTTP_BODY_JSON_PARSE_ERROR", "status", res.status, rawText.slice(0, 800));
          lastOllamaDiag = { status: res.status, snippet: rawText.slice(0, 400) };
        }
        if (!res.ok) {
          console.error("OLLAMA_HTTP_ERROR", res.status, rawText.slice(0, 2000));
          lastOllamaDiag = {
            status: res.status,
            snippet: (parsed.error || rawText).slice(0, 400),
          };
        } else if (typeof parsed.error === "string" && parsed.error.trim()) {
          console.error("OLLAMA_HTTP_ERROR_FIELD", parsed.error.slice(0, 2000));
          lastOllamaDiag = { status: res.status, snippet: parsed.error.slice(0, 400) };
        } else if (typeof parsed.response === "string" && parsed.response.trim().length > 0) {
          console.log("OLLAMA_SUCCESS", "response_chars", parsed.response.length);
          body = { response: parsed.response };
          break;
        } else if (res.ok) {
          console.error("OLLAMA_EMPTY_RESPONSE", "status", res.status, rawText.slice(0, 800));
          lastOllamaDiag = { status: res.status, snippet: rawText.slice(0, 400) };
        }
      }
      if (attempt < retries) {
        await sleep(80 * attempt);
      }
    }
    if (!body) {
      const diag = {
        base: ollamaBaseUrl(),
        model: ollamaModel(),
        timeoutMs,
        retries,
        ...lastOllamaDiag,
      };
      console.warn("[listing-feel] ANALYTICS_MODE=FALLBACK ollama unavailable/timeout", diag);
      appendAnalyticsDiagnostic({
        ts: new Date().toISOString(),
        listing_id: input.listing_id ?? null,
        analytics_mode: "FALLBACK",
        fallback_used: true,
        error: JSON.stringify(diag).slice(0, 2000),
      });
      if (process.env.ANALYTICS_LISTING_FEEL_STRICT_OLLAMA === "1") {
        throw new Error(`[listing-feel] OLLAMA_REQUIRED ${JSON.stringify(diag)}`);
      }
      if (noSilentFallback()) {
        throw new Error(`[listing-feel] ANALYTICS_MODE=FALLBACK ${JSON.stringify(diag)}`);
      }
      if (listingFeelNoRuleFallback()) {
        throw new Error(`[listing-feel] OLLAMA_GENERATE_FAILED ${JSON.stringify(diag)}`);
      }
      ollamaFailuresTotal.inc();
      return ruleBasedListingFeel(audience);
    }
    const text = await runStage("analytics.model.postprocess", async () =>
      normalizeListingFeelOutput(String(body.response || "")),
    );
    const quality_score = await runStage("analytics.quality.compute", async () => computeListingFeelQualityScore(text));
    const genMs = Date.now() - t0;
    observeWithTraceExemplar(ollamaLatencyMs, genMs);
    observeWithTraceExemplar(listingFeelQualityHist, quality_score);
    observeWithTraceExemplar(analyticsGenerationLatencyMs, genMs, { path: "listing_feel_generate" });
    observeWithTraceExemplar(analyticsGenerationTokensEstimated, Math.ceil(prompt.length / 4));
    await runStage("analytics.persistence.cache_write", async () => {
      try {
        await pool.query(
          `INSERT INTO analytics.listing_feel_cache (content_hash, audience, model, analysis_text) VALUES ($1, $2, $3, $4)
       ON CONFLICT (content_hash, audience) DO NOTHING`,
          [hash, audience, ollamaModel(), text],
        );
      } catch (e) {
        console.error("[listing-feel] legacy cache insert failed (non-fatal; response still returned)", e);
      }
    });
    return { analysis_text: text, model_used: ollamaModel(), quality_score };
        });
      });
    } finally {
      if (gotLock) await releaseLockWithToken(lockKey, token);
    }
  });
}
