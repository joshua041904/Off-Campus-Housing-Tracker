import { SpanStatusCode, trace } from "@opentelemetry/api";
import { buildListingIntelligencePrompts, maxTokensForDepth } from "./analysisModes.js";
import {
  analyticsGenerationConfidence,
  analyticsGenerationDurationMs,
  analyticsGenerationLatencyMs,
  analyticsGenerationPredictTokens,
  analyticsGenerationRequestsTotal,
  analyticsGenerationTokensEstimated,
  analyticsGenerationTruncatedTotal,
  analyticsLiV2SchemaRepairTotal,
  analyticsOllamaTimeoutTotal,
} from "./analyticsGenerationMetrics.js";
import {
  buildConfidenceExplanation,
  computeCalibratedConfidence,
} from "./confidenceCalibration.js";
import { AIFailure, AI_FAILURE_TIMEOUT, isAIFailure } from "../aiFailure.js";
import { maybeInjectAiChaos } from "../aiChaos.js";
import { isAnalyticsDevFastMode } from "./generationLimits.js";
import { getOllamaGenerateTimeoutMs } from "./ollamaTimeoutBudget.js";
import { ollamaKeepAliveRequestField } from "./ollamaKeepAlive.js";
import { mergeEnsembleIntelligence } from "./ensembleEngine.js";
import { latencyDegradesEnsemble, recordListingFeelLatencyMs } from "./latencyThrottle.js";
import { runMetaEval } from "./metaEval.js";
import { parseEnsembleModels, shouldUseEnsemble } from "./modelRouter.js";
import {
  coerceListingIntelligence,
  postProcessListingIntelligence,
  wordJaccardSimilarity,
} from "./postProcessor.js";
import { appendAnalyticsDiagnostic } from "./diagnostics.js";
import { renderListingIntelligenceToAnalysisText } from "./renderIntelligence.js";
import { assertValidListingIntelligenceStrict } from "./structuredValidation.js";
import { truncateListingInput, estimateTokensFromChars } from "./inputGuard.js";
import { detectNumericContradictionInProse, parseMonthlyUsd } from "./analysisConsistency.js";
import { getAiControlPlaneState } from "./aiControlPlaneRuntime.js";
import { deterministicSamplePercent, scoreArbitrationCandidates } from "./aiCanaryArbitration.js";
import { recordArbitrationResult } from "./analyticsUnifiedObservabilityMetrics.js";
import type {
  AnalysisDepth,
  ListingIntelligenceGenerationMeta,
  ListingIntelligenceMeta,
  ListingIntelligenceOutput,
} from "./types.js";

const aiTracer = trace.getTracer("och-analytics-ai");

function parseModelCosts(): Record<string, number> {
  const raw = String(process.env.ANALYTICS_MODEL_COSTS || "").trim();
  if (!raw) return {};
  const out: Record<string, number> = {};
  for (const p of raw.split(",")) {
    const [k, v] = p.split("=", 2).map((s) => s.trim());
    if (!k) continue;
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

function isAbortLike(err: unknown): boolean {
  if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) return true;
  if (typeof DOMException !== "undefined" && err instanceof DOMException && err.name === "AbortError") return true;
  const s = String(err);
  return /aborted|AbortError|timeout/i.test(s);
}

function liV2ThrowOnTimeout(): boolean {
  const ex = process.env.ANALYTICS_LISTING_FEEL_EXPOSE_ERRORS;
  const thr = process.env.ANALYTICS_LI_V2_THROW_ON_TIMEOUT;
  return ex === "1" || ex === "true" || thr === "1" || thr === "true";
}

function quickVerdictEntropy(verdict: string): number | undefined {
  const t = String(verdict || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  const words = t.split(" ").filter(Boolean);
  if (words.length < 2) return undefined;
  const freq = new Map<string, number>();
  for (const w of words) {
    freq.set(w, (freq.get(w) ?? 0) + 1);
  }
  let h = 0;
  for (const c of freq.values()) {
    const p = c / words.length;
    h -= p * Math.log2(p);
  }
  return h;
}

function listingIntelligenceV2Enabled(): boolean {
  if (process.env.ANALYTICS_LISTING_INTELLIGENCE_V2 !== "1") return false;
  // Dev-fast (Colima + host Metal, `make ollama-env`, etc.): use legacy plain `/api/generate` like `ollama run`
  // — JSON v2 + repair + meta_eval is much heavier and causes timeouts/degraded UX. Opt back in with:
  // ANALYTICS_LI_V2_IN_DEV_FAST=1
  if (isAnalyticsDevFastMode()) {
    const force =
      process.env.ANALYTICS_LI_V2_IN_DEV_FAST === "1" || process.env.ANALYTICS_LI_V2_IN_DEV_FAST === "true";
    return force;
  }
  return true;
}

export function isListingIntelligenceV2Enabled(): boolean {
  return listingIntelligenceV2Enabled();
}

export function v2Temperature(): number {
  const n = Number(process.env.ANALYTICS_LI_V2_TEMPERATURE ?? "0.45");
  return Number.isFinite(n) ? Math.min(1.5, Math.max(0, n)) : 0.45;
}

function v2TopP(): number {
  const n = Number(process.env.ANALYTICS_LI_V2_TOP_P ?? "0.9");
  return Number.isFinite(n) ? Math.min(1, Math.max(0.05, n)) : 0.9;
}

function v2RepeatPenalty(): number {
  const n = Number(process.env.ANALYTICS_LI_V2_REPEAT_PENALTY ?? "1.08");
  return Number.isFinite(n) ? Math.min(2, Math.max(1, n)) : 1.08;
}

function v2FrequencyPenalty(): number {
  const n = Number(process.env.ANALYTICS_LI_V2_FREQUENCY_PENALTY ?? "0.4");
  return Number.isFinite(n) ? Math.min(2, Math.max(0, n)) : 0.4;
}

function v2PresencePenalty(): number {
  const n = Number(process.env.ANALYTICS_LI_V2_PRESENCE_PENALTY ?? "0.3");
  return Number.isFinite(n) ? Math.min(2, Math.max(0, n)) : 0.3;
}

function v2NumCtx(): number {
  const n = Number(process.env.ANALYTICS_LI_V2_NUM_CTX ?? "2048");
  return Number.isFinite(n) ? Math.min(8192, Math.max(512, Math.floor(n))) : 2048;
}

function dualPassEnabled(): boolean {
  const qaFast = process.env.ANALYTICS_QA_FAST_MODE === "1" || process.env.ANALYTICS_QA_FAST_MODE === "true";
  const devFast = process.env.ANALYTICS_DEV_FAST_MODE === "1" || process.env.ANALYTICS_DEV_FAST_MODE === "true";
  return process.env.ANALYTICS_LI_DUAL_PASS === "1" && !qaFast && !devFast;
}

function dualAgreementMin(): number {
  const n = Number(process.env.ANALYTICS_LI_DUAL_AGREEMENT_MIN ?? "0.48");
  return Number.isFinite(n) ? Math.min(1, Math.max(0.2, n)) : 0.48;
}

function parseDepth(raw: unknown): AnalysisDepth {
  const s = String(raw || "standard").toLowerCase();
  if (s === "quick" || s === "deep") return s;
  return "standard";
}

function dualPassAgreementScore(a: ListingIntelligenceOutput, b: ListingIntelligenceOutput): number {
  const join = (xs: string[]) => xs.join(" | ");
  const parts = [
    wordJaccardSimilarity(a.verdict, b.verdict),
    wordJaccardSimilarity(a.market_positioning, b.market_positioning),
    wordJaccardSimilarity(join(a.value_drivers), join(b.value_drivers)),
    wordJaccardSimilarity(join(a.negotiation_leverage), join(b.negotiation_leverage)),
    wordJaccardSimilarity(join(a.risk_flags), join(b.risk_flags)),
  ];
  return parts.reduce((s, x) => s + x, 0) / parts.length;
}

function schemaRepairRetryEnabled(): boolean {
  if (isAnalyticsDevFastMode()) return false;
  return process.env.ANALYTICS_LI_SCHEMA_REPAIR !== "0" && process.env.ANALYTICS_LI_SCHEMA_REPAIR !== "false";
}

async function ollamaGenerateJson(params: {
  baseUrl: string;
  model: string;
  system: string;
  prompt: string;
  numPredict: number;
  timeoutMs: number;
  fetchOnce: typeof fetch;
}): Promise<{ output: ListingIntelligenceOutput | null; latency_ms: number }> {
  return aiTracer.startActiveSpan("ollama.generate", async (span) => {
    span.setAttribute("ai.model", params.model);
    span.setAttribute("ai.temperature", v2Temperature());
    span.setAttribute("ai.tokens_input", Math.round((params.system.length + params.prompt.length) / 4));
    const effectiveMs = getOllamaGenerateTimeoutMs();
    const controller = new AbortController();
    const softTimer = setTimeout(() => {
      console.warn("[analytics-li-v2] Ollama /api/generate still in flight (>5s soft threshold)");
    }, 5000);
    const hardTimer = setTimeout(() => controller.abort(), effectiveMs);
    const wall0 = Date.now();
    let timeoutStage: "generate" | "schema_repair" = "generate";

    const fail = (lat: number) => {
      span.setAttribute("ai.latency_ms", lat);
      span.setAttribute("ai.fallback", true);
      span.setStatus({ code: SpanStatusCode.ERROR });
      return { output: null, latency_ms: lat };
    };

    const fetchAndCoerce = async (
      userPrompt: string,
      signal: AbortSignal,
    ): Promise<{ out: ListingIntelligenceOutput | null; reason: string }> => {
      await maybeInjectAiChaos("li_v2_generate");
      const res = await params.fetchOnce(`${params.baseUrl.replace(/\/$/, "")}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: params.model,
          format: "json",
          stream: false,
          keep_alive: ollamaKeepAliveRequestField(),
          system: params.system,
          prompt: userPrompt,
          options: {
            num_ctx: v2NumCtx(),
            num_predict: params.numPredict,
            temperature: v2Temperature(),
            top_p: v2TopP(),
            repeat_penalty: v2RepeatPenalty(),
            frequency_penalty: v2FrequencyPenalty(),
            presence_penalty: v2PresencePenalty(),
          },
        }),
        signal,
      });
      const rawText = await res.text().catch(() => "");
      let outer: { response?: string; error?: string } = {};
      try {
        outer = rawText ? (JSON.parse(rawText) as { response?: string; error?: string }) : {};
      } catch {
        return { out: null, reason: "ollama_outer_json_parse" };
      }
      if (!res.ok || typeof outer.error === "string") {
        return { out: null, reason: "ollama_http_or_error_field" };
      }
      const r = outer.response;
      if (typeof r !== "string" || !r.trim()) {
        return { out: null, reason: "empty_model_response_string" };
      }
      let inner: unknown;
      try {
        inner = JSON.parse(r);
      } catch {
        return { out: null, reason: "model_inner_json_parse" };
      }
      const coerced = postProcessListingIntelligence(coerceListingIntelligence(inner));
      try {
        assertValidListingIntelligenceStrict(coerced);
        return { out: coerced, reason: "" };
      } catch (e) {
        const msg = (e as Error)?.message ?? String(e);
        console.warn("[analytics-li-v2] invalid structured output:", msg);
        return { out: null, reason: msg };
      }
    };

    try {
      let lastReason = "";
      let first = await fetchAndCoerce(params.prompt, controller.signal);
      let out = first.out;
      lastReason = first.reason;
      if (!out && schemaRepairRetryEnabled()) {
        analyticsLiV2SchemaRepairTotal.inc();
        const repair = `\n\nSCHEMA_REPAIR: Previous JSON failed validation (${first.reason.slice(0, 800)}).
Return ONLY valid JSON matching the contract. Arrays (value_drivers, risk_flags, missing_information, negotiation_leverage) must be JSON arrays of strings only — no objects inside array elements.`;
        const remain = Math.max(8_000, effectiveMs - (Date.now() - wall0));
        const repairSig = AbortSignal.timeout(remain);
        timeoutStage = "schema_repair";
        const second = await fetchAndCoerce(`${params.prompt}${repair}`, repairSig);
        out = second.out;
        lastReason = second.reason;
      }
      if (!out) {
        console.warn("[analytics-li-v2] generate failed after coerce/validate:", lastReason);
        return fail(Date.now() - wall0);
      }
      const lat = Date.now() - wall0;
      span.setAttribute("ai.latency_ms", lat);
      span.setAttribute("ai.tokens_output", params.numPredict);
      span.setAttribute("ai.fallback", false);
      span.setStatus({ code: SpanStatusCode.OK });
      return { output: out, latency_ms: lat };
    } catch (e: unknown) {
      const lat = Date.now() - wall0;
      if (isAbortLike(e)) {
        try {
          analyticsOllamaTimeoutTotal.inc({ stage: timeoutStage });
        } catch {
          /* metric */
        }
        console.error(
          "AI_TIMEOUT",
          JSON.stringify({
            duration_ms: lat,
            timeout_ms: effectiveMs,
            predict_tokens: params.numPredict,
            stage: timeoutStage,
          }),
        );
        if (liV2ThrowOnTimeout()) {
          throw new AIFailure(AI_FAILURE_TIMEOUT, "Ollama /api/generate timed out", {
            duration_ms: lat,
            timeout_ms: effectiveMs,
            num_predict: params.numPredict,
            stage: timeoutStage,
          });
        }
      }
      return fail(lat);
    } finally {
      clearTimeout(softTimer);
      clearTimeout(hardTimer);
    }
  });
}

export async function runListingIntelligenceV2(input: {
  baseUrl: string;
  primaryModel: string;
  audience: "landlord" | "renter";
  title: string;
  description: string;
  priceUsd: string;
  analysis_depth?: unknown;
  listingFacts?: Record<string, unknown>;
  listing_id?: string | null;
  timeoutMs: number;
  fetchOnce: typeof fetch;
}): Promise<{
  analysis_text: string;
  intelligence: ListingIntelligenceOutput;
  meta: ListingIntelligenceMeta;
  duration_ms: number;
  generation_meta: ListingIntelligenceGenerationMeta;
} | null> {
  if (!listingIntelligenceV2Enabled()) return null;

  analyticsGenerationRequestsTotal.inc({ path: "listing_intelligence_v2" });

  const wall0 = Date.now();
  const depth = parseDepth(input.analysis_depth);
  const devFast = isAnalyticsDevFastMode();
  const { text: descGuarded, truncated } = truncateListingInput(String(input.description || ""));
  const { system, prompt, primary_mode, secondary_lens } = buildListingIntelligencePrompts({
    audience: input.audience,
    title: input.title,
    description: descGuarded,
    priceUsd: input.priceUsd,
    depth,
    listingFacts: input.listingFacts,
  });

  const prompt_chars = system.length + prompt.length;
  const token_estimate = estimateTokensFromChars(prompt_chars);
  const numPredict = maxTokensForDepth(depth);

  if (truncated) analyticsGenerationTruncatedTotal.inc();

  const ensembleModels = parseEnsembleModels();
  const useEnsemble = shouldUseEnsemble({
    descriptionLength: descGuarded.length,
    depth,
    modelCount: ensembleModels.length,
  });

  let outputs: ListingIntelligenceOutput[];
  let modelsUsed: string[];
  let genLatencySum = 0;
  let low_consensus: boolean | undefined;

  if (useEnsemble && ensembleModels.length >= 2) {
    const m1 = ensembleModels[0]!;
    const m2 = ensembleModels[1]!;
    const [ra, rb] = await Promise.all([
      ollamaGenerateJson({
        baseUrl: input.baseUrl,
        model: m1,
        system,
        prompt,
        numPredict,
        timeoutMs: input.timeoutMs,
        fetchOnce: input.fetchOnce,
      }),
      ollamaGenerateJson({
        baseUrl: input.baseUrl,
        model: m2,
        system,
        prompt,
        numPredict,
        timeoutMs: input.timeoutMs,
        fetchOnce: input.fetchOnce,
      }),
    ]);
    genLatencySum += ra.latency_ms + rb.latency_ms;
    const a = ra.output;
    const b = rb.output;
    const ok = [a, b].filter(Boolean) as ListingIntelligenceOutput[];
    if (ok.length === 0) return null;
    outputs = ok.length === 1 ? [ok[0]!] : ok;
    modelsUsed = ok.length === 2 ? [m1, m2] : [m1];
  } else {
    const first = await ollamaGenerateJson({
      baseUrl: input.baseUrl,
      model: input.primaryModel,
      system,
      prompt,
      numPredict,
      timeoutMs: input.timeoutMs,
      fetchOnce: input.fetchOnce,
    });
    genLatencySum += first.latency_ms;
    if (!first.output) return null;
    outputs = [first.output];

    if (dualPassEnabled()) {
      const second = await ollamaGenerateJson({
        baseUrl: input.baseUrl,
        model: input.primaryModel,
        system,
        prompt,
        numPredict,
        timeoutMs: input.timeoutMs,
        fetchOnce: input.fetchOnce,
      });
      genLatencySum += second.latency_ms;
      if (second.output) {
        const agreement = dualPassAgreementScore(first.output, second.output);
        const minA = dualAgreementMin();
        if (agreement < minA) {
          low_consensus = true;
          outputs = [
            postProcessListingIntelligence({
              ...first.output,
              confidence_score: Math.round(Math.max(0, first.output.confidence_score * 0.88)),
            }),
          ];
        }
      }
    }
    modelsUsed = [input.primaryModel];
  }

  const merged =
    outputs.length >= 2 ? mergeEnsembleIntelligence(outputs) : postProcessListingIntelligence({ ...outputs[0]! });

  try {
    assertValidListingIntelligenceStrict(merged);
  } catch {
    return null;
  }

  if (outputs.length === 1) {
    merged.confidence_score = Math.round(
      Math.max(0, Math.min(100, merged.confidence_score * 0.55 + computeCalibratedConfidence(outputs) * 0.45)),
    );
  } else {
    merged.confidence_score = computeCalibratedConfidence(outputs);
  }

  let arbitrationMode: "shadow" | "canary" | undefined;
  let arbitrationWinnerModel: string | undefined;
  let arbitrationCanaryModel: string | undefined;
  let arbitrationScoreGap: number | undefined;
  const cp = getAiControlPlaneState();
  const canaryModel = String(process.env.ANALYTICS_CANARY_MODEL || "").trim();
  const canaryEnabled = Boolean(canaryModel && canaryModel !== input.primaryModel);
  const shadowMode = process.env.ANALYTICS_CANARY_SHADOW === "1";
  const shouldSampleCanary =
    canaryEnabled &&
    deterministicSamplePercent(
      `${input.listing_id || input.title}|${cp.promptVersion}|${input.primaryModel}|${canaryModel}`,
      cp.canaryPercent,
    );
  if (canaryEnabled && (shadowMode || shouldSampleCanary) && !devFast) {
    const canaryRes = await ollamaGenerateJson({
      baseUrl: input.baseUrl,
      model: canaryModel,
      system,
      prompt,
      numPredict,
      timeoutMs: input.timeoutMs,
      fetchOnce: input.fetchOnce,
    });
    genLatencySum += canaryRes.latency_ms;
    if (canaryRes.output) {
      const modelCosts = parseModelCosts();
      const weights = cp.arbitrationWeights;
      const primaryCandidate = {
        model: input.primaryModel,
        output: merged,
        latencyMs: Math.max(1, genLatencySum / Math.max(1, modelsUsed.length)),
        costPerReq: modelCosts[input.primaryModel] ?? modelCosts["*"] ?? 0.001,
        reliabilityScore: 0.95,
      };
      const canaryCandidate = {
        model: canaryModel,
        output: canaryRes.output,
        latencyMs: canaryRes.latency_ms,
        costPerReq: modelCosts[canaryModel] ?? modelCosts["*"] ?? 0.001,
        reliabilityScore: 0.95,
      };
      const arbitration = scoreArbitrationCandidates([primaryCandidate, canaryCandidate], weights);
      const top = arbitration.scored[0];
      const second = arbitration.scored[1];
      arbitrationWinnerModel = arbitration.winner.model;
      arbitrationCanaryModel = canaryModel;
      arbitrationScoreGap = top && second ? Math.max(0, top.score - second.score) : 0;
      arbitrationMode = shadowMode ? "shadow" : "canary";
      recordArbitrationResult({
        mode: arbitrationMode,
        winnerModel: arbitrationWinnerModel,
        topScore: top?.score ?? 0,
        secondScore: second?.score ?? 0,
      });
      if (!shadowMode && arbitration.winner.model === canaryModel) {
        merged.confidence_score = canaryRes.output.confidence_score;
        Object.assign(merged, postProcessListingIntelligence({ ...canaryRes.output }));
        modelsUsed = [input.primaryModel, canaryModel];
      }
    }
  }

  const latencyDegraded = latencyDegradesEnsemble();
  const confidence_explanation = buildConfidenceExplanation({
    outputs,
    calibrated: merged.confidence_score,
    ensemble: outputs.length >= 2,
    latencyDegraded,
  });

  const metaEval = devFast
    ? null
    : await aiTracer.startActiveSpan("analytics.meta_eval", async (span) => {
        span.setAttribute("ai.model", input.primaryModel);
        const r = await runMetaEval({
          baseUrl: input.baseUrl,
          model: input.primaryModel,
          output: merged,
          timeoutMs: input.timeoutMs,
          fetchOnce: input.fetchOnce,
        });
        span.setStatus({ code: SpanStatusCode.OK });
        return r;
      });

  const verdictEntropy = quickVerdictEntropy(merged.verdict);
  if (!devFast && verdictEntropy != null) {
    await aiTracer.startActiveSpan("analytics.entropy.compute", async (span) => {
      span.setAttribute("ai.entropy", verdictEntropy);
      span.setAttribute("ai.model", modelsUsed.join("+"));
      span.setAttribute("ai.temperature", v2Temperature());
      span.setStatus({ code: SpanStatusCode.OK });
    });
  }

  const meta: ListingIntelligenceMeta = {
    contract_version: "listing-intelligence.v2",
    primary_mode,
    secondary_lens,
    analysis_depth: depth,
    ensemble_models_used: modelsUsed,
    confidence_explanation,
    meta_eval_ok: metaEval?.ok,
    meta_eval_issues: metaEval?.issues,
    low_consensus,
    arbitration_mode: arbitrationMode,
    arbitration_winner_model: arbitrationWinnerModel,
    arbitration_canary_model: arbitrationCanaryModel,
    arbitration_score_gap: arbitrationScoreGap,
  };

  let mergedOut = merged;
  let analysis_text = renderListingIntelligenceToAnalysisText(mergedOut, {
    confidence_explanation,
    primary_mode,
    secondary_lens,
    depth,
  });

  const monthlyRent = parseMonthlyUsd(input.priceUsd);
  const numericCheck0 = detectNumericContradictionInProse(analysis_text, monthlyRent);
  await aiTracer.startActiveSpan("analytics.numeric.validation", async (span) => {
    span.setAttribute("ai.numeric_conflict", numericCheck0.conflict);
    if (numericCheck0.reason) span.setAttribute("ai.validation_note", numericCheck0.reason);
    span.setStatus({ code: SpanStatusCode.OK });
  });

  if (
    numericCheck0.conflict &&
    process.env.ANALYTICS_NUMERIC_RECONCILE_RETRY !== "0" &&
    !devFast &&
    !useEnsemble &&
    outputs.length < 2
  ) {
    try {
      const repair =
        "\n\nCRITICAL: Regenerate JSON — all asking/list rent figures and negotiation bullets must reconcile with the Asking (USD/month) line in the user prompt. No contradictory headline rents.";
      const second = await ollamaGenerateJson({
        baseUrl: input.baseUrl,
        model: input.primaryModel,
        system: `${system}${repair}`,
        prompt,
        numPredict,
        timeoutMs: input.timeoutMs,
        fetchOnce: input.fetchOnce,
      });
      genLatencySum += second.latency_ms;
      if (second.output) {
        try {
          const m2 = postProcessListingIntelligence({ ...second.output });
          assertValidListingIntelligenceStrict(m2);
          mergedOut = m2;
          if (outputs.length === 1) {
            mergedOut.confidence_score = Math.round(
              Math.max(0, Math.min(100, mergedOut.confidence_score * 0.55 + computeCalibratedConfidence([mergedOut]) * 0.45)),
            );
          }
          analysis_text = renderListingIntelligenceToAnalysisText(mergedOut, {
            confidence_explanation,
            primary_mode,
            secondary_lens,
            depth,
          });
        } catch {
          mergedOut = merged;
          analysis_text = renderListingIntelligenceToAnalysisText(mergedOut, {
            confidence_explanation,
            primary_mode,
            secondary_lens,
            depth,
          });
        }
      }
    } catch (retryErr) {
      if (liV2ThrowOnTimeout() && isAIFailure(retryErr)) throw retryErr;
      console.warn("[analytics-li-v2] numeric reconcile retry failed; keeping first pass", retryErr);
    }
  }

  const duration_ms = Date.now() - wall0;
  recordListingFeelLatencyMs(duration_ms);

  analyticsGenerationLatencyMs.observe({ path: "listing_intelligence_v2" }, duration_ms);
  analyticsGenerationTokensEstimated.observe(token_estimate);
  analyticsGenerationConfidence.observe(Math.min(100, Math.max(0, mergedOut.confidence_score)));
  try {
    analyticsGenerationDurationMs.observe({ depth }, duration_ms);
    analyticsGenerationPredictTokens.observe({ depth }, numPredict);
  } catch {
    /* metric registration */
  }

  const generation_meta: ListingIntelligenceGenerationMeta = {
    latency_ms: duration_ms,
    prompt_chars,
    truncated,
    model: modelsUsed.join("+"),
    temperature: v2Temperature(),
    max_tokens: numPredict,
    token_estimate,
    low_consensus,
    ollama_calls_latency_ms_sum: genLatencySum,
  };

  appendAnalyticsDiagnostic({
    ts: new Date().toISOString(),
    listing_id: input.listing_id ?? null,
    primary_mode,
    secondary_lens,
    depth,
    prompt_system_len: system.length,
    prompt_user_len: prompt.length,
    prompt_user_preview: prompt.slice(0, 500),
    max_tokens: numPredict,
    temperature: v2Temperature(),
    top_p: v2TopP(),
    repeat_penalty: v2RepeatPenalty(),
    frequency_penalty: v2FrequencyPenalty(),
    presence_penalty: v2PresencePenalty(),
    ensemble: outputs.length >= 2,
    confidence_score: mergedOut.confidence_score,
    fallback_used: false,
    analytics_mode: "LLM",
    latency_ms: duration_ms,
    truncated,
    token_estimate,
    low_consensus: low_consensus ?? false,
    error: null,
  });

  return { analysis_text, intelligence: mergedOut, meta, duration_ms, generation_meta };
}
