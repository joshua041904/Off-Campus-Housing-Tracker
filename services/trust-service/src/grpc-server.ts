import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import {
  registerHealthService,
  resolveProtoPath,
  createOchStrictMtlsServerCredentials,
} from "@common/utils";
import { pool } from "./db.js";

const TRUST_PROTO = resolveProtoPath("trust.proto");
const pd = protoLoader.loadSync(TRUST_PROTO, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const trustProto = grpc.loadPackageDefinition(pd) as any;

function reviewRatingOk(r: number): boolean {
  return Number.isInteger(r) && r >= 1 && r <= 5;
}

const trustHandlers = {
  FlagListing(call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) {
    const req = call.request || {};
    const listingId = String(req.listing_id || "").trim();
    const reporterId = String(req.reporter_id || "").trim();
    const reason = String(req.reason || "").trim();
    if (!listingId || !reporterId || !reason) {
      cb({ code: grpc.status.INVALID_ARGUMENT, message: "listing_id, reporter_id, reason required" });
      return;
    }
    pool
      .query(
        `INSERT INTO trust.listing_flags (listing_id, reporter_id, reason) VALUES ($1::uuid, $2::uuid, $3) RETURNING id, status::text`,
        [listingId, reporterId, reason]
      )
      .then((r) => cb(null, { flag_id: r.rows[0].id, status: r.rows[0].status }))
      .catch((e) => {
        console.error("[FlagListing]", e);
        cb({ code: grpc.status.INTERNAL, message: "failed" });
      });
  },

  ReportAbuse(call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) {
    const req = call.request || {};
    const t = String(req.abuse_target_type || "").toLowerCase();
    const targetId = String(req.target_id || "").trim();
    const reporterId = String(req.reporter_id || "").trim();
    const category = String(req.category || "abuse").trim();
    const details = String(req.details || "").trim();
    if (!targetId || !reporterId || (t !== "listing" && t !== "user")) {
      cb({ code: grpc.status.INVALID_ARGUMENT, message: "abuse_target_type (listing|user), target_id, reporter_id required" });
      return;
    }
    const reason = `${category}: ${details}`.slice(0, 2000);
    if (t === "listing") {
      pool
        .query(
          `INSERT INTO trust.listing_flags (listing_id, reporter_id, reason, description) VALUES ($1::uuid, $2::uuid, $3, $4) RETURNING id, status::text`,
          [targetId, reporterId, category, details || null]
        )
        .then((r) => cb(null, { flag_id: r.rows[0].id, status: r.rows[0].status }))
        .catch((e) => {
          console.error("[ReportAbuse listing]", e);
          cb({ code: grpc.status.INTERNAL, message: "failed" });
        });
    } else {
      pool
        .query(
          `INSERT INTO trust.user_flags (user_id, reporter_id, reason, description) VALUES ($1::uuid, $2::uuid, $3, $4) RETURNING id, status::text`,
          [targetId, reporterId, category, details || null]
        )
        .then((r) => cb(null, { flag_id: r.rows[0].id, status: r.rows[0].status }))
        .catch((e) => {
          console.error("[ReportAbuse user]", e);
          cb({ code: grpc.status.INTERNAL, message: "failed" });
        });
    }
  },

  SubmitReview(call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) {
    const req = call.request || {};
    const bookingId = String(req.booking_id || "").trim();
    const reviewerId = String(req.reviewer_id || "").trim();
    const revieweeId = String(req.reviewee_id || "").trim();
    const rating = Number(req.rating);
    const comment = String(req.comment || "");
    if (!bookingId || !reviewerId || !reviewRatingOk(rating)) {
      cb({ code: grpc.status.INVALID_ARGUMENT, message: "booking_id, reviewer_id, rating 1-5 required" });
      return;
    }
    if (!revieweeId) {
      cb({ code: grpc.status.INVALID_ARGUMENT, message: "reviewee_id required for housing trust reviews" });
      return;
    }
    pool
      .query(
        `INSERT INTO trust.reviews (booking_id, reviewer_id, target_type, target_id, rating, comment)
         VALUES ($1::uuid, $2::uuid, 'user'::trust.review_target_type, $3::uuid, $4, $5) RETURNING id`,
        [bookingId, reviewerId, revieweeId, rating, comment || null]
      )
      .then((r) => cb(null, { review_id: r.rows[0].id }))
      .catch((e) => {
        console.error("[SubmitReview]", e);
        if (String(e?.message || "").includes("unique") || String(e?.code) === "23505") {
          cb({ code: grpc.status.ALREADY_EXISTS, message: "duplicate review" });
          return;
        }
        cb({ code: grpc.status.INTERNAL, message: "failed" });
      });
  },

  SubmitPeerReview(call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) {
    const req = call.request || {};
    const bookingId = String(req.booking_id || "").trim();
    const reviewerId = String(req.reviewer_id || "").trim();
    const revieweeId = String(req.reviewee_id || "").trim();
    const side = String(req.side || "").trim();
    const rating = Number(req.rating);
    const comment = String(req.comment || "");
    if (!bookingId || !reviewerId || !revieweeId || !reviewRatingOk(rating)) {
      cb({ code: grpc.status.INVALID_ARGUMENT, message: "booking_id, reviewer_id, reviewee_id, rating 1-5 required" });
      return;
    }
    const meta = `[${side}] ${comment}`.slice(0, 4000);
    pool
      .query(
        `INSERT INTO trust.reviews (booking_id, reviewer_id, target_type, target_id, rating, comment)
         VALUES ($1::uuid, $2::uuid, 'user'::trust.review_target_type, $3::uuid, $4, $5) RETURNING id`,
        [bookingId, reviewerId, revieweeId, rating, meta || null]
      )
      .then((r) => cb(null, { review_id: r.rows[0].id }))
      .catch((e) => {
        console.error("[SubmitPeerReview]", e);
        if (String(e?.message || "").includes("unique") || String(e?.code) === "23505") {
          cb({ code: grpc.status.ALREADY_EXISTS, message: "duplicate review" });
          return;
        }
        cb({ code: grpc.status.INTERNAL, message: "failed" });
      });
  },

  GetReputation(call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) {
    const userId = String(call.request?.user_id || "").trim();
    if (!userId) {
      cb({ code: grpc.status.INVALID_ARGUMENT, message: "user_id required" });
      return;
    }
    pool
      .query(`SELECT user_id, reputation_score FROM trust.reputation WHERE user_id = $1::uuid`, [userId])
      .then((r) => {
        if (!r.rows[0]) {
          cb(null, { user_id: userId, score: 0 });
          return;
        }
        cb(null, { user_id: userId, score: Number(r.rows[0].reputation_score) || 0 });
      })
      .catch((e) => {
        console.error("[GetReputation]", e);
        cb({ code: grpc.status.INTERNAL, message: "failed" });
      });
  },
};

export function startGrpcServer(port: number): grpc.Server {
  const server = new grpc.Server();
  server.addService(trustProto.trust.TrustService.service, trustHandlers);

  registerHealthService(server, "trust.TrustService", async () => {
    try {
      await pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  });

  let credentials: grpc.ServerCredentials;
  try {
    credentials = createOchStrictMtlsServerCredentials("trust gRPC");
    console.log("[trust gRPC] strict mTLS (client cert required)");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  server.bindAsync(`0.0.0.0:${port}`, credentials, (err, boundPort) => {
    if (err) {
      console.error("[trust gRPC] bind error:", err);
      return;
    }
    server.start();
    console.log(`[trust gRPC] listening on ${boundPort}`);
  });

  return server;
}
