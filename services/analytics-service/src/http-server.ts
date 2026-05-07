import express, { type Application, type NextFunction, type Request, type Response } from "express";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import { httpCounter, register, createHttpConcurrencyGuard } from "@common/utils";
import { checkKafkaConnectivity } from "@common/utils/kafka";
import { inferNetProtoForSpan, mountDebugTraceHeaders, tracingMiddleware } from "@common/utils/otel";
import { withCircuitBreaker } from "./circuitBreaker.js";
import { pool } from "./db.js";
import { bookingReadPool } from "./booking-read-pool.js";
import { analyzeListingFeelText } from "./ollama.js";
import { applyListingCreatedForAnalytics } from "./listing-metrics-projection.js";
import { runHybridSearch } from "./lib/hybrid-search.js";
import {
  recordAnalyzeTelemetry,
  recordAnalysisQualityGate,
  recordTelemetryIngest,
} from "./intelligence/analyticsUnifiedObservabilityMetrics.js";
import { analyticsListingFeelCatchTotal } from "./intelligence/analyticsGenerationMetrics.js";
import { detectNumericContradictionInProse } from "./intelligence/analysisConsistency.js";
import { isAIFailure } from "./aiFailure.js";
import { classifyListingFeelHttpFailure } from "./listingFeelFailure.js";
import { warmupOllamaFromEnv } from "./ollamaWarmup.js";

const aiTracer = trace.getTracer("och-analytics-ai");

type Authed = Request & { userId?: string };

const ANALYTICS_LISTING_ID_UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** When true, listing-feel/analyze return structured errors instead of soft-degraded 200 bodies. */
function listingFeelExposeErrors(): boolean {
  return (
    process.env.ANALYTICS_LISTING_FEEL_EXPOSE_ERRORS === "1" || process.env.ANALYTICS_LISTING_FEEL_EXPOSE_ERRORS === "true"
  );
}

/** No soft-degraded bullets — return 502 `generation_failed` with real error detail (pipe debugging). */
function listingFeelNoDegradedMask(): boolean {
  return (
    process.env.ANALYTICS_LISTING_FEEL_NO_DEGRADED_MASK === "1" ||
    process.env.ANALYTICS_LISTING_FEEL_NO_DEGRADED_MASK === "true"
  );
}

function listingFeelBareErrors502(): boolean {
  return listingFeelExposeErrors() || listingFeelNoDegradedMask();
}

function listingFeelErrorDetail(e: unknown): { detail: string; error_name?: string } {
  if (e instanceof Error) {
    return { detail: `${e.name}: ${e.message}`.slice(0, 4000), error_name: e.name };
  }
  return { detail: String(e).slice(0, 4000) };
}

function listingFeelTelemetryTemperature(): number {
  const n = Number(process.env.ANALYTICS_LISTING_FEEL_TEMPERATURE || "0.3");
  return Number.isFinite(n) ? n : 0.3;
}

/** Fail-soft body when `analyzeListingFeelText` throws (last resort — prefer fixing root cause + metrics on `failure_code`). */
function listingFeelDegradedPayload(
  audienceRaw: string,
  opts?: { failure_code?: string; failure_detail?: string },
): {
  analysis_text: string;
  model_used: string;
  quality_score: number;
  degraded: true;
  listing_feel_status: "degraded";
  failure_code: string;
  failure_detail?: string;
} {
  const audience = String(audienceRaw || "renter").toLowerCase() === "landlord" ? "landlord" : "renter";
  const analysis_text =
    audience === "landlord"
      ? "- We could not finish an AI summary for this listing right now—try Analyze again in a moment.\n- Until it succeeds, sanity-check asking rent vs nearby comps and clarify deposits, fees, and what is included in rent."
      : "- We could not finish an AI summary for this listing right now—try Analyze again in a moment.\n- Until it succeeds, compare rent to similar units nearby and confirm fees and utilities before you apply.";
  const failure_code = (opts?.failure_code || "UNKNOWN").slice(0, 64);
  return {
    analysis_text,
    model_used: "error-degraded",
    quality_score: 0.25,
    degraded: true,
    listing_feel_status: "degraded",
    failure_code,
    ...(opts?.failure_detail ? { failure_detail: opts.failure_detail.slice(0, 500) } : {}),
  };
}

function intelligenceConfidenceFromOut(out: {
  intelligence_json?: string;
  generation_meta?: unknown;
}): number | undefined {
  const gm = out.generation_meta as { confidence_score?: number } | null | undefined;
  const g = gm?.confidence_score;
  if (typeof g === "number" && Number.isFinite(g)) return g;
  if (!out.intelligence_json) return undefined;
  try {
    const j = JSON.parse(out.intelligence_json) as { intelligence?: { confidence_score?: number } };
    const c = j.intelligence?.confidence_score;
    return typeof c === "number" && Number.isFinite(c) ? c : undefined;
  } catch {
    return undefined;
  }
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

function intelligenceEntropyFromOut(out: { intelligence_json?: string }): number | undefined {
  if (!out.intelligence_json) return undefined;
  try {
    const j = JSON.parse(out.intelligence_json) as { intelligence?: { verdict?: string } };
    const v = j.intelligence?.verdict;
    return typeof v === "string" ? quickVerdictEntropy(v) : undefined;
  } catch {
    return undefined;
  }
}

async function fetchListingJsonForAnalyze(
  listingId: string,
): Promise<Record<string, unknown> | null> {
  const base = (process.env.LISTINGS_HTTP || "http://127.0.0.1:4012").replace(/\/$/, "");
  const url = `${base}/listings/${listingId}`;
  let upstream: globalThis.Response;
  try {
    const ms = Number(process.env.ANALYTICS_LISTING_FETCH_TIMEOUT_MS ?? "12000");
    const timeout = Number.isFinite(ms) ? Math.min(120_000, Math.max(1000, ms)) : 12_000;
    upstream = await fetch(url, { signal: AbortSignal.timeout(timeout) });
  } catch {
    throw new Error("listing_fetch_failed");
  }
  if (upstream.status === 404) return null;
  if (!upstream.ok) throw new Error(`listing_http_${upstream.status}`);
  return (await upstream.json()) as Record<string, unknown>;
}

function optionalUser(req: Authed, _res: Response, next: NextFunction) {
  const uid = (req.get("x-user-id") || "").trim();
  if (uid) req.userId = uid;
  next();
}

function requireSelfUser(req: Authed, res: Response, next: NextFunction) {
  const hdr = (req.get("x-user-id") || "").trim();
  const param = String((req.params as { userId?: string }).userId || "").trim();
  if (!hdr || !param || hdr !== param) {
    res.status(403).json({ error: "forbidden: x-user-id must match userId" });
    return;
  }
  req.userId = hdr;
  next();
}

function internalListingIngestGuard(req: Request, res: Response, next: NextFunction): void {
  if (process.env.ANALYTICS_SYNC_MODE !== "1") {
    res.status(404).json({ error: "not found" });
    return;
  }
  const token = (process.env.ANALYTICS_INTERNAL_INGEST_TOKEN || "").trim();
  if (token && (req.get("x-internal-ingest-token") || "").trim() !== token) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
}

export function createAnalyticsHttpApp(): Application {
  const app = express();
  app.use(tracingMiddleware);
  mountDebugTraceHeaders(app);
  app.use(express.json({ limit: "512kb" }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const traceId = req.get("x-trace-id") || "none";
    const internalCall = req.get("x-internal-call") || "";
    if (req.path.startsWith("/internal/") || internalCall) {
      console.log(
        `[analytics-http] traceId=${traceId} x-internal-call=${internalCall} ${req.method} ${req.path}`,
      );
    }
    next();
  });
  app.use((req, res, next) => {
    res.on("finish", () =>
      httpCounter.inc({
        service: "analytics",
        route: req.path,
        method: req.method,
        code: res.statusCode,
        proto: inferNetProtoForSpan(req),
      })
    );
    next();
  });

  app.get(["/healthz", "/health"], async (_req, res) => {
    let db: "connected" | "disconnected" = "disconnected";
    try {
      await pool.query("SELECT 1");
      db = "connected";
    } catch {
      /* keep db disconnected */
    }

    const kafkaConfigured = Boolean(process.env.KAFKA_BROKER?.trim());
    let kafka: "connected" | "disconnected" | "skipped" = "skipped";
    if (kafkaConfigured) {
      const up = await withCircuitBreaker(async () => {
        return aiTracer.startActiveSpan("analytics.kafka.metadata_refresh", async (span) => {
          span.setAttribute("kafka.check", "healthz");
          try {
            const ok = await checkKafkaConnectivity();
            if (!ok) throw new Error("kafka unreachable");
            span.setStatus({ code: SpanStatusCode.OK });
            return true;
          } catch (e) {
            span.setStatus({ code: SpanStatusCode.ERROR, message: String((e as Error)?.message || e) });
            throw e;
          }
        });
      });
      kafka = up ? "connected" : "disconnected";
    }

    const strictKafka = process.env.ANALYTICS_HEALTHZ_REQUIRE_KAFKA === "1";
    if (strictKafka && kafkaConfigured && kafka !== "connected") {
      res.status(503).json({ ok: false, db, kafka: "down" });
      return;
    }

    if (db === "connected") {
      res.json(
        kafkaConfigured
          ? { ok: true, db: "connected", kafka }
          : { ok: true, db: "connected" },
      );
      return;
    }
    res.json(
      kafkaConfigured
        ? { ok: true, db: "disconnected", warning: "database unavailable", kafka }
        : { ok: true, db: "disconnected", warning: "database unavailable" },
    );
  });

  /** Readiness for host/in-cluster Ollama (avoids first heavy request paying cold-connect alone). */
  app.get("/health/ollama", async (_req, res) => {
    const base = (process.env.OLLAMA_BASE_URL || "").replace(/\/$/, "");
    if (!base) {
      res.status(503).json({ ok: false, ollama: "unset", hint: "OLLAMA_BASE_URL not configured" });
      return;
    }
    const ms = Number(process.env.ANALYTICS_OLLAMA_HEALTH_TIMEOUT_MS ?? "5000");
    const timeoutMs = Number.isFinite(ms) ? Math.min(30_000, Math.max(1000, Math.floor(ms))) : 5000;
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), timeoutMs);
      const r = await fetch(`${base}/api/tags`, { method: "GET", signal: ac.signal });
      clearTimeout(t);
      if (!r.ok) {
        res.status(503).json({ ok: false, ollama: "error", status: r.status, base });
        return;
      }
      res.json({ ok: true, ollama: "reachable", base });
    } catch (e) {
      res.status(503).json({
        ok: false,
        ollama: "down",
        base,
        error: String((e as Error)?.message || e),
      });
    }
  });

  app.get("/readyz", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true, ready: true });
    } catch {
      res.status(503).json({ ok: false, ready: false });
    }
  });

  app.get("/metrics", async (_req, res) => {
    res.setHeader("Content-Type", register.contentType);
    res.end(await register.metrics());
  });

  /**
   * Internal ingestion must run BEFORE the HTTP concurrency guard.
   * Listings-service sync posts here; counting it against ANALYTICS_HTTP_MAX_CONCURRENT can 503 under load
   * and drop events → daily_metrics never updates (E2E system-integrity).
   */
  app.post("/internal/ingest/listing-created", internalListingIngestGuard, async (req, res) => {
    const body = req.body as { event_id?: string; listed_at_day?: string };
    const eventId = String(body?.event_id || "").trim();
    const day = String(body?.listed_at_day || "").trim().slice(0, 10);
    if (!/^[0-9a-f-]{36}$/i.test(eventId) || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      res.status(400).json({ error: "event_id (uuid) and listed_at_day (YYYY-MM-DD) required" });
      return;
    }
    try {
      await applyListingCreatedForAnalytics(pool, eventId, day);
      res.status(204).end();
    } catch (e) {
      console.error("[internal/ingest/listing-created]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.use(
    createHttpConcurrencyGuard({
      envVar: "ANALYTICS_HTTP_MAX_CONCURRENT",
      defaultMax: 60,
      serviceLabel: "analytics-service",
    }),
  );

  /** Public aggregate read (gateway OPEN route). */
  app.get("/daily-metrics", async (req, res) => {
    try {
      const date = String(req.query.date || "").trim();
      if (!date) {
        res.status(400).json({ error: "date=YYYY-MM-DD required" });
        return;
      }
      const r = await pool.query(
        `SELECT date, new_users, new_listings, new_bookings, completed_bookings, messages_sent, listings_flagged
         FROM analytics.daily_metrics WHERE date = $1::date`,
        [date]
      );
      if (!r.rows[0]) {
        res.json({
          date,
          new_users: 0,
          new_listings: 0,
          new_bookings: 0,
          completed_bookings: 0,
          messages_sent: 0,
          listings_flagged: 0,
        });
        return;
      }
      const row = r.rows[0];
      res.json({
        date: row.date,
        new_users: row.new_users,
        new_listings: row.new_listings,
        new_bookings: row.new_bookings,
        completed_bookings: row.completed_bookings,
        messages_sent: row.messages_sent ?? 0,
        listings_flagged: row.listings_flagged ?? 0,
      });
    } catch (e) {
      console.error("[daily-metrics]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  app.get("/insights/watchlist/:userId", optionalUser, async (req: Authed, res) => {
    try {
      const uid = String(req.params.userId || "").trim();
      if (!uid) {
        res.status(400).json({ error: "user_id required" });
        return;
      }
      const r = await pool.query(
        `SELECT COALESCE(SUM(adds), 0)::int AS a, COALESCE(SUM(removes), 0)::int AS r
         FROM analytics.user_watchlist_daily
         WHERE user_id = $1::uuid AND day >= (CURRENT_DATE - INTERVAL '30 days')`,
        [uid]
      );
      res.json({
        user_id: uid,
        watchlist_adds_30d: r.rows[0]?.a ?? 0,
        watchlist_removes_30d: r.rows[0]?.r ?? 0,
        notes: "Projected from domain events; run infra/db/04-analytics-watchlist-engagement.sql and consumers.",
      });
    } catch (e) {
      console.error("[watchlist insights]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  /** POST-only insight routes: explicit GET → 405 JSON (avoids Express default plain-text "Cannot GET …"). */
  const insightsPostOnlyGet405 =
    (hint: string) =>
    (_req: Request, res: Response) => {
      res.status(405).set("Allow", "POST").json({
        error: "method_not_allowed",
        code: "POST_REQUIRED",
        message: hint,
        ui: "/analytics",
      });
    };
  app.get(
    "/insights/listing-feel",
    insightsPostOnlyGet405(
      "Use POST with JSON (title, price_cents, …). Public edge path: POST /api/analytics/insights/listing-feel.",
    ),
  );
  app.get(
    "/insights/hybrid-search",
    insightsPostOnlyGet405("Use POST with JSON { query, limit? }. Edge: POST /api/analytics/insights/hybrid-search."),
  );
  app.get(
    "/insights/listing/:listingId/analyze",
    insightsPostOnlyGet405("Use POST. Edge: POST /api/analytics/insights/listing/:listingId/analyze."),
  );

  /** Past housing searches (booking DB read-only when POSTGRES_URL_BOOKINGS is set on analytics pod). */
  app.get("/insights/search-summary/:userId", requireSelfUser, async (req: Authed, res) => {
    const uid = String(req.params.userId || "").trim();
    if (!bookingReadPool) {
      res.json({
        user_id: uid,
        items: [] as unknown[],
        hint: "Set POSTGRES_URL_BOOKINGS on analytics-service for search-history insights (read-only).",
      });
      return;
    }
    try {
      const r = await bookingReadPool.query(
        `SELECT query, min_price_cents, max_price_cents, max_distance_km, latitude, longitude, created_at
         FROM booking.search_history WHERE user_id = $1::uuid ORDER BY created_at DESC LIMIT 20`,
        [uid]
      );
      res.json({
        user_id: uid,
        items: r.rows,
        notification_hook: "notification-service can consume dev.analytics.events for digest pushes (planned).",
      });
    } catch (e) {
      console.error("[search-summary]", e);
      res.status(500).json({ error: "booking read failed (check POSTGRES_URL_BOOKINGS and network)" });
    }
  });

  app.post("/insights/listing-feel", optionalUser, async (req: Authed, res) => {
    const t0 = Date.now();
    const body = req.body as Record<string, unknown>;
    const title = String(body.title || "");
    const description = String(body.description || "");
    const price_cents = Number(body.price_cents ?? 0);
    const audience = String(body.audience || "renter");
    const analysis_depth = body.analysis_depth;
    if (!title || !Number.isFinite(price_cents)) {
      res.status(400).json({ error: "title and price_cents required" });
      return;
    }
    const strictEnv =
      process.env.ANALYTICS_LISTING_FEEL_STRICT_OLLAMA === "1" || process.env.ANALYTICS_LISTING_FEEL_NO_SILENT_FALLBACK === "1";
    try {
      const out = await aiTracer.startActiveSpan("analytics.http.listing_feel", async (span) => {
        span.setAttribute("http.route", "/insights/listing-feel");
        const o = await analyzeListingFeelText({ title, description, price_cents, audience, analysis_depth });
        span.setAttribute("ai.model", o.model_used);
        span.setAttribute("ai.fallback", String(o.model_used === "none" || o.model_used === "rule-based-fallback"));
        span.setStatus({ code: SpanStatusCode.OK });
        return o;
      });
      const wallMs = Date.now() - t0;
      const fb =
        String(out.model_used).includes("fallback") ||
        out.model_used === "none" ||
        out.model_used === "rule-based-fallback" ||
        out.model_used === "error-degraded";
      try {
        recordAnalyzeTelemetry({
          route: "listing_feel",
          httpStatus: 200,
          latencyMs: wallMs,
          modelUsed: out.model_used,
          temperature: Number(out.generation_meta?.temperature ?? listingFeelTelemetryTemperature()),
          tokensInput: out.generation_meta?.prompt_chars,
          tokensOutput: out.generation_meta?.token_estimate,
          fallback: fb,
          confidence: intelligenceConfidenceFromOut(out),
        });
        const monthly = price_cents / 100;
        const numC = detectNumericContradictionInProse(out.analysis_text || "", monthly);
        await aiTracer.startActiveSpan("analytics.quality.compute", async (span) => {
          const variableEntropyMode =
            process.env.QA_VARIABILITY_MODE === "variable" || process.env.ANALYTICS_QUALITY_VARIABLE_ENTROPY === "1";
          const gate = recordAnalysisQualityGate({
            analysisTextLen: (out.analysis_text || "").length,
            entropy: intelligenceEntropyFromOut(out),
            numericConflict: numC.conflict,
            variableEntropyMode,
          });
          span.setAttribute("ai.quality_score", gate.score);
          span.setAttribute("ai.quality_low", gate.low);
          span.setStatus({ code: SpanStatusCode.OK });
        });
      } catch (telErr) {
        console.warn("[listing-feel] telemetry/quality gate failed (non-fatal)", telErr);
      }
      res.json(out);
    } catch (e) {
      console.error("[listing-feel]", e);
      const wallMs = Date.now() - t0;
      const fc = classifyListingFeelHttpFailure(e);
      try {
        analyticsListingFeelCatchTotal.inc({ code: fc.code });
      } catch {
        /* metric registration */
      }
      console.error(
        "LISTING_FEEL_DEGRADED_REASON:",
        JSON.stringify({ code: fc.code, detail: fc.detail, duration_ms: wallMs }),
      );
      const hardFail =
        process.env.ANALYTICS_LISTING_FEEL_HARD_FAIL === "1" ||
        process.env.ANALYTICS_LISTING_FEEL_HARD_FAIL === "true";
      if (hardFail) {
        console.error("[listing-feel] ANALYTICS_LISTING_FEEL_HARD_FAIL=1 — returning 500 (no soft degraded body)");
        return res.status(500).json({
          error: "listing_feel_hard_fail",
          failure_code: fc.code,
          failure_detail: fc.detail,
        });
      }
      if (listingFeelBareErrors502()) {
        const { detail, error_name } = listingFeelErrorDetail(e);
        return res.status(502).json({
          error: "generation_failed",
          failure_code: fc.code,
          failure_detail: fc.detail,
          detail,
          ...(error_name ? { error_name } : {}),
          ...(isAIFailure(e) ? { meta: e.meta } : {}),
          duration_ms: wallMs,
        });
      }
      if (strictEnv) {
        res.status(500).json({ error: "internal" });
        return;
      }
      const degraded = listingFeelDegradedPayload(audience, {
        failure_code: fc.code,
        failure_detail: fc.detail,
      });
      try {
        recordAnalyzeTelemetry({
          route: "listing_feel",
          httpStatus: 200,
          latencyMs: wallMs,
          modelUsed: degraded.model_used,
          temperature: listingFeelTelemetryTemperature(),
          fallback: true,
        });
        recordAnalysisQualityGate({
          analysisTextLen: degraded.analysis_text.length,
          entropy: undefined,
          numericConflict: false,
          variableEntropyMode: false,
        });
      } catch {
        /* ignore secondary telemetry errors */
      }
      res.status(200).json(degraded);
    }
  });

  /**
   * Absolute minimal Ollama pipe: one `POST /api/generate`, plain JSON body (model + prompt + stream:false).
   * Enable with `ANALYTICS_LISTING_FEEL_MINIMAL_ENDPOINT=1` for networking vs Node fetch isolation.
   */
  app.post("/insights/listing-feel-minimal", optionalUser, async (req: Authed, res) => {
    if (process.env.ANALYTICS_LISTING_FEEL_MINIMAL_ENDPOINT !== "1") {
      res.status(404).json({ error: "not_enabled", hint: "set ANALYTICS_LISTING_FEEL_MINIMAL_ENDPOINT=1 on analytics-service" });
      return;
    }
    const base = (process.env.OLLAMA_BASE_URL || "").replace(/\/$/, "");
    if (!base) {
      res.status(503).json({ error: "OLLAMA_BASE_URL_unset" });
      return;
    }
    const b = req.body as Record<string, unknown>;
    const prompt = String(b.prompt ?? "").trim();
    if (!prompt) {
      res.status(400).json({ error: "prompt required (JSON body { \"prompt\": \"...\" })" });
      return;
    }
    const model = String(b.model || process.env.OLLAMA_MODEL || "llama3.2:1b");
    const url = `${base}/api/generate`;
    try {
      console.log("[listing-feel-minimal] OLLAMA_URL", url, "model", model, "prompt_chars", prompt.length);
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt, stream: false }),
      });
      const text = await r.text();
      if (!r.ok) {
        console.error("OLLAMA_HTTP_ERROR", r.status, text.slice(0, 2000));
        res.status(502).json({
          error: "OLLAMA_HTTP_ERROR",
          status: r.status,
          body_preview: text.slice(0, 2000),
        });
        return;
      }
      let parsed: { response?: string; error?: string } = {};
      try {
        parsed = text ? (JSON.parse(text) as { response?: string; error?: string }) : {};
      } catch {
        console.error("OLLAMA_JSON_PARSE_ERROR", text.slice(0, 500));
        res.status(502).json({ error: "ollama_response_not_json", body_preview: text.slice(0, 500) });
        return;
      }
      if (typeof parsed.error === "string" && parsed.error.trim()) {
        console.error("OLLAMA_MODEL_ERROR_FIELD", parsed.error);
        res.status(502).json({ error: "ollama_error_field", message: parsed.error });
        return;
      }
      const analysis_text = String(parsed.response ?? "");
      console.log("OLLAMA_SUCCESS", "response_chars", analysis_text.length);
      res.json({ analysis_text, model_used: model, quality_score: 0.5, minimal: true });
    } catch (err) {
      console.error("OLLAMA_FETCH_ERROR", err);
      res.status(502).json({
        error: "OLLAMA_FETCH_ERROR",
        detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    }
  });

  /** Pull listing from listings-service HTTP, run listing intelligence on structured facts. */
  const handleListingAnalyze = async (req: Authed, res: Response) => {
    const listingId = String(req.params.listingId || "").trim();
    if (!ANALYTICS_LISTING_ID_UUID_RX.test(listingId)) {
      res.status(400).json({ error: "invalid listing id" });
      return;
    }
    const t0 = Date.now();
    let lj: Record<string, unknown> | null;
    try {
      lj = await fetchListingJsonForAnalyze(listingId);
    } catch {
      res.status(502).json({ error: "listing upstream failed" });
      return;
    }
    if (!lj) {
      res.status(404).json({ error: "listing not found" });
      return;
    }
    const title = String(lj.title ?? "");
    const description = String(lj.description ?? "");
    let price_cents = Number(lj.price_cents);
    if (!Number.isFinite(price_cents) && typeof lj.price === "number") {
      price_cents = Math.round(lj.price * 100);
    }
    if (!Number.isFinite(price_cents)) price_cents = 0;
    const body = (req.body || {}) as Record<string, unknown>;
    const audience = String(body.audience ?? "renter");
    const analysis_depth = body.analysis_depth;
    const listing_facts: Record<string, unknown> = {
      amenities: lj.amenities,
      location: lj.location,
      lease_terms: lj.lease_terms,
      availability_status: lj.availability_status,
      smoke_free: lj.smoke_free,
      pet_friendly: lj.pet_friendly,
      furnished: lj.furnished,
      images: lj.images,
      landlord_id: lj.landlord_id,
      listed_at: lj.listed_at,
      latitude: lj.latitude,
      longitude: lj.longitude,
    };
    try {
      const out = await aiTracer.startActiveSpan("analytics.http.analyze_listing", async (span) => {
        span.setAttribute("http.route", "/insights/listing/:listingId/analyze");
        span.setAttribute("listing.id", listingId);
        const o = await analyzeListingFeelText({
          title,
          description,
          price_cents,
          audience,
          analysis_depth,
          listing_facts,
          listing_id: listingId,
        });
        const wallMs = Date.now() - t0;
        const fallbackUsed =
          String(o.model_used).includes("fallback") ||
          o.model_used === "none" ||
          o.model_used === "rule-based-fallback";
        const ent = intelligenceEntropyFromOut(o);
        const conf = intelligenceConfidenceFromOut(o);
        span.setAttribute("ai.model", o.model_used);
        span.setAttribute("ai.temperature", Number(o.generation_meta?.temperature ?? listingFeelTelemetryTemperature()));
        span.setAttribute("ai.tokens_input", Number(o.generation_meta?.prompt_chars ?? 0));
        span.setAttribute("ai.tokens_output", Number(o.generation_meta?.token_estimate ?? 0));
        span.setAttribute("ai.fallback", fallbackUsed);
        if (ent != null) span.setAttribute("ai.entropy", ent);
        if (conf != null) span.setAttribute("ai.confidence", conf);
        span.setAttribute("ai.latency_ms", wallMs);
        span.setStatus({ code: SpanStatusCode.OK });
        recordAnalyzeTelemetry({
          route: "analyze_listing",
          httpStatus: 200,
          latencyMs: wallMs,
          modelUsed: o.model_used,
          temperature: Number(o.generation_meta?.temperature ?? listingFeelTelemetryTemperature()),
          tokensInput: o.generation_meta?.prompt_chars,
          tokensOutput: o.generation_meta?.token_estimate,
          fallback: fallbackUsed,
          entropy: ent,
          confidence: conf,
        });
        const monthly = price_cents / 100;
        const numC = detectNumericContradictionInProse(o.analysis_text || "", monthly);
        await aiTracer.startActiveSpan("analytics.quality.compute", async (span) => {
          const variableEntropyMode =
            process.env.QA_VARIABILITY_MODE === "variable" || process.env.ANALYTICS_QUALITY_VARIABLE_ENTROPY === "1";
          const gate = recordAnalysisQualityGate({
            analysisTextLen: (o.analysis_text || "").length,
            entropy: ent ?? undefined,
            numericConflict: numC.conflict,
            variableEntropyMode,
          });
          span.setAttribute("ai.quality_score", gate.score);
          span.setAttribute("ai.quality_low", gate.low);
          span.setStatus({ code: SpanStatusCode.OK });
        });
        return { o, wallMs, fallbackUsed, ent };
      });
      let intelligence: unknown = null;
      if (out.o.intelligence_json) {
        try {
          intelligence = JSON.parse(out.o.intelligence_json);
        } catch {
          intelligence = null;
        }
      }
      res.json({
        listing_id: listingId,
        analysis_text: out.o.analysis_text,
        model_used: out.o.model_used,
        quality_score: out.o.quality_score,
        intelligence_json: out.o.intelligence_json,
        intelligence,
        confidence_explanation: out.o.confidence_explanation,
        generation_meta: out.o.generation_meta,
        _meta: {
          fallback_used: out.fallbackUsed,
          request_latency_ms: out.wallMs,
          ...(out.o.generation_meta ?? {}),
          latency_ms: out.o.generation_meta?.latency_ms ?? out.wallMs,
        },
      });
    } catch (e) {
      console.error("[listing-analyze]", e);
      const wallMs = Date.now() - t0;
      const fc = classifyListingFeelHttpFailure(e);
      if (listingFeelBareErrors502()) {
        try {
          analyticsListingFeelCatchTotal.inc({ code: fc.code });
        } catch {
          /* metric */
        }
        const { detail, error_name } = listingFeelErrorDetail(e);
        res.status(502).json({
          error: "generation_failed",
          failure_code: fc.code,
          failure_detail: fc.detail,
          detail,
          ...(error_name ? { error_name } : {}),
          ...(isAIFailure(e) ? { meta: e.meta } : {}),
          listing_id: listingId,
          duration_ms: wallMs,
        });
        return;
      }
      res.status(500).json({ error: String((e as Error)?.message || "internal") });
    }
  };

  app.post("/insights/listing/:listingId/analyze", optionalUser, handleListingAnalyze);
  app.post("/listing/:listingId/analyze", optionalUser, handleListingAnalyze);

  /** Push QA suite duration + optional kafka skew gauges (used by scripts/analytics-qa after local runs). */
  app.post("/internal/telemetry", (req: Request, res: Response) => {
    if (process.env.ANALYTICS_TELEMETRY_INGEST !== "1") {
      res.status(404).json({ error: "not found" });
      return;
    }
    const tok = (req.get("x-telemetry-token") || "").trim();
    const want = (process.env.ANALYTICS_TELEMETRY_TOKEN || "").trim();
    if (!want || tok !== want) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    recordTelemetryIngest((req.body || {}) as Record<string, unknown>);
    res.json({ ok: true });
  });

  app.post("/insights/hybrid-search", optionalUser, async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as { query?: unknown; limit?: unknown };
      const query = String(body.query || "").trim();
      const limit = Number(body.limit ?? 5);
      if (!query) {
        res.status(400).json({ error: "query required" });
        return;
      }
      const items = await runHybridSearch({ query, limit });
      res.json({
        query,
        items,
        count: items.length,
        ranking: "hybrid(bm25+pgvector)+ltr",
      });
    } catch (e) {
      console.error("[hybrid-search]", e);
      res.status(500).json({ error: "internal" });
    }
  });

  return app;
}

export function startAnalyticsHttpServer(port: number): void {
  const app = createAnalyticsHttpApp();
  app.listen(port, "0.0.0.0", () => {
    console.log(`[analytics HTTP] listening on ${port}`);
    void warmupOllamaFromEnv();
  });
}
