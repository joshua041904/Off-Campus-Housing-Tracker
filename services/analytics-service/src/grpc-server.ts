import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { trace, SpanStatusCode } from "@opentelemetry/api";
import {
  registerHealthService,
  resolveProtoPath,
  createOchGrpcServerCredentialsForBind,
} from "@common/utils";
import { pool } from "./db.js";
import { analyzeListingFeelText } from "./ollama.js";
import { recordAnalyzeTelemetry } from "./intelligence/analyticsUnifiedObservabilityMetrics.js";

const aiTracer = trace.getTracer("och-analytics-ai");

const PROTO = resolveProtoPath("analytics.proto");
const pd = protoLoader.loadSync(PROTO, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const root = grpc.loadPackageDefinition(pd) as any;

/** Raw `AnalyticsService` RPC implementations (unit-test via `call` + `cb`). */
export const analyticsGrpcHandlers = {
  GetDailyMetrics(call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) {
    const date = String(call.request?.date || "").trim();
    if (!date) {
      cb({ code: grpc.status.INVALID_ARGUMENT, message: "date required" });
      return;
    }
    pool
      .query(
        `SELECT new_users, new_listings, new_bookings, completed_bookings, COALESCE(messages_sent,0) AS messages_sent, COALESCE(listings_flagged,0) AS listings_flagged
         FROM analytics.daily_metrics WHERE date = $1::date`,
        [date]
      )
      .then((r) => {
        if (!r.rows[0]) {
          cb(null, { new_users: 0, new_listings: 0, new_bookings: 0, completed_bookings: 0, messages_sent: 0, listings_flagged: 0 });
          return;
        }
        const row = r.rows[0];
        cb(null, {
          new_users: Number(row.new_users) || 0,
          new_listings: Number(row.new_listings) || 0,
          new_bookings: Number(row.new_bookings) || 0,
          completed_bookings: Number(row.completed_bookings) || 0,
          messages_sent: Number(row.messages_sent) || 0,
          listings_flagged: Number(row.listings_flagged) || 0,
        });
      })
      .catch((e) => {
        console.error("[GetDailyMetrics]", e);
        cb({ code: grpc.status.INTERNAL, message: "failed" });
      });
  },

  GetRecommendations(call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) {
    pool
      .query(
        `SELECT name, version FROM analytics.recommendation_models WHERE is_active = true ORDER BY id DESC LIMIT 1`
      )
      .then((rm) => {
        const name = rm.rows[0]?.name ?? "baseline";
        const version = rm.rows[0]?.version ?? "v0";
        cb(null, { listings: [], model_name: name, model_version: version });
      })
      .catch(() => cb(null, { listings: [], model_name: "baseline", model_version: "v0" }));
  },

  GetWatchlistInsights(call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) {
    const userId = String(call.request?.user_id || "").trim();
    if (!userId) {
      cb({ code: grpc.status.INVALID_ARGUMENT, message: "user_id required" });
      return;
    }
    pool
      .query(
        `SELECT COALESCE(SUM(adds),0)::int AS a, COALESCE(SUM(removes),0)::int AS r
         FROM analytics.user_watchlist_daily
         WHERE user_id = $1::uuid AND day >= (CURRENT_DATE - INTERVAL '30 days')`,
        [userId]
      )
      .then((r) =>
        cb(null, {
          watchlist_adds_30d: r.rows[0]?.a ?? 0,
          watchlist_removes_30d: r.rows[0]?.r ?? 0,
          notes: "Projected counters; populate via Kafka consumers / booking events.",
        })
      )
      .catch((e) => {
        console.error("[GetWatchlistInsights]", e);
        cb({ code: grpc.status.INTERNAL, message: "failed" });
      });
  },

  AnalyzeListingFeel(call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) {
    const req = call.request || {};
    const title = String(req.title || "");
    const price_cents = Number(req.price_cents);
    if (!title || !Number.isFinite(price_cents)) {
      cb({ code: grpc.status.INVALID_ARGUMENT, message: "title and price_cents required" });
      return;
    }
    const t0 = Date.now();
    aiTracer
      .startActiveSpan("analytics.grpc.analyze_listing_feel", async (span) => {
        span.setAttribute("rpc.system", "grpc");
        span.setAttribute("rpc.service", "AnalyticsService.AnalyzeListingFeel");
        try {
          const o = await analyzeListingFeelText({
            title,
            description: String(req.description || ""),
            price_cents,
            audience: String(req.audience || "renter"),
            analysis_depth: req.analysis_depth,
          });
          const wallMs = Date.now() - t0;
          const fb =
            String(o.model_used).includes("fallback") ||
            o.model_used === "none" ||
            o.model_used === "rule-based-fallback";
          span.setAttribute("ai.model", o.model_used);
          span.setAttribute("ai.fallback", fb);
          span.setAttribute("ai.latency_ms", wallMs);
          span.setStatus({ code: SpanStatusCode.OK });
          recordAnalyzeTelemetry({
            route: "grpc_analyze_listing_feel",
            httpStatus: 200,
            latencyMs: wallMs,
            modelUsed: o.model_used,
            temperature: Number(o.generation_meta?.temperature ?? 0.3),
            tokensInput: o.generation_meta?.prompt_chars,
            tokensOutput: o.generation_meta?.token_estimate,
            fallback: fb,
          });
          return o;
        } catch (e) {
          span.setStatus({ code: SpanStatusCode.ERROR, message: String((e as Error)?.message || e) });
          throw e;
        }
      })
      .then((o) => cb(null, o))
      .catch((e) => {
        console.error("[AnalyzeListingFeel]", e);
        cb({ code: grpc.status.INTERNAL, message: "failed" });
      });
  },
};

/** Raw `RecommendationAdminService` RPC implementations. */
export const analyticsRecommendationAdminGrpcHandlers = {
  ActivateModel(call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) {
    const name = String(call.request?.name || "").trim();
    const version = String(call.request?.version || "").trim();
    if (!name || !version) {
      cb({ code: grpc.status.INVALID_ARGUMENT, message: "name and version required" });
      return;
    }
    pool
      .query(`UPDATE analytics.recommendation_models SET is_active = false`)
      .then(() =>
        pool.query(`UPDATE analytics.recommendation_models SET is_active = true WHERE name = $1 AND version = $2`, [
          name,
          version,
        ])
      )
      .then(() => cb(null, {}))
      .catch((e) => {
        console.error("[ActivateModel]", e);
        cb({ code: grpc.status.INTERNAL, message: "failed" });
      });
  },

  SetExperimentTraffic(call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) {
    const experiment_name = String(call.request?.experiment_name || "").trim();
    const traffic_percentage = Number(call.request?.traffic_percentage);
    if (!experiment_name || !Number.isInteger(traffic_percentage)) {
      cb({ code: grpc.status.INVALID_ARGUMENT, message: "experiment_name and traffic_percentage required" });
      return;
    }
    pool
      .query(
        `UPDATE analytics.recommendation_experiments SET traffic_percentage = $1 WHERE name = $2`,
        [traffic_percentage, experiment_name]
      )
      .then(() => cb(null, {}))
      .catch((e) => {
        console.error("[SetExperimentTraffic]", e);
        cb({ code: grpc.status.INTERNAL, message: "failed" });
      });
  },
};

/** K8s grpc-health-probe callback (same semantics as `registerHealthService` on this server). */
export async function analyticsGrpcHealthProbe(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export function startGrpcServer(port: number): grpc.Server {
  const server = new grpc.Server();
  server.addService(root.analytics.AnalyticsService.service, analyticsGrpcHandlers);
  server.addService(
    root.analytics.RecommendationAdminService.service,
    analyticsRecommendationAdminGrpcHandlers,
  );

  // Primary name must match K8s readiness -service=; register every gRPC service FQ name on this server.
  registerHealthService(
    server,
    "analytics.AnalyticsService",
    analyticsGrpcHealthProbe,
    ["analytics.RecommendationAdminService"]
  );

  let credentials: grpc.ServerCredentials;
  try {
    credentials = createOchGrpcServerCredentialsForBind("analytics gRPC");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  server.bindAsync(`0.0.0.0:${port}`, credentials, (err: Error | null, boundPort: number) => {
    if (err) {
      console.error("[analytics gRPC] bind error:", err);
      return;
    }
    console.log(`[analytics gRPC] listening on ${boundPort}`);
  });

  return server;
}
