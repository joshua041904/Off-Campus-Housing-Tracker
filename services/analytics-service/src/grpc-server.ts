import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import {
  registerHealthService,
  resolveProtoPath,
  createOchStrictMtlsServerCredentials,
} from "@common/utils";
import { pool } from "./db.js";
import { analyzeListingFeelText } from "./ollama.js";

const PROTO = resolveProtoPath("analytics.proto");
const pd = protoLoader.loadSync(PROTO, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const root = grpc.loadPackageDefinition(pd) as any;

const analyticsService = {
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
    analyzeListingFeelText({
      title,
      description: String(req.description || ""),
      price_cents,
      audience: String(req.audience || "renter"),
    })
      .then((o) => cb(null, o))
      .catch((e) => {
        console.error("[AnalyzeListingFeel]", e);
        cb({ code: grpc.status.INTERNAL, message: "failed" });
      });
  },
};

const adminService = {
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

export function startGrpcServer(port: number): grpc.Server {
  const server = new grpc.Server();
  server.addService(root.analytics.AnalyticsService.service, analyticsService);
  server.addService(root.analytics.RecommendationAdminService.service, adminService);

  // Primary name must match K8s readiness -service=; register every gRPC service FQ name on this server.
  registerHealthService(
    server,
    "analytics.AnalyticsService",
    async () => {
      try {
        await pool.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    },
    ["analytics.RecommendationAdminService"]
  );

  let credentials: grpc.ServerCredentials;
  try {
    credentials = createOchStrictMtlsServerCredentials("analytics gRPC");
    console.log("[analytics gRPC] strict mTLS (client cert required)");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  server.bindAsync(`0.0.0.0:${port}`, credentials, (err: Error | null, boundPort: number) => {
    if (err) {
      console.error("[analytics gRPC] bind error:", err);
      return;
    }
    server.start();
    console.log(`[analytics gRPC] listening on ${boundPort}`);
  });

  return server;
}
