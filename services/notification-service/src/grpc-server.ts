import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import {
  registerHealthService,
  resolveProtoPath,
  createOchStrictMtlsServerCredentials,
} from "@common/utils";
import { pool } from "./db.js";

const NOTIF_PROTO = resolveProtoPath("notification.proto");
const pd = protoLoader.loadSync(NOTIF_PROTO, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const notifProto = grpc.loadPackageDefinition(pd) as any;

const handlers = {
  GetUserPreferences(call: grpc.ServerUnaryCall<any, any>, cb: grpc.sendUnaryData<any>) {
    const userId = String(call.request?.user_id || "").trim();
    if (!userId) {
      cb({ code: grpc.status.INVALID_ARGUMENT, message: "user_id required" });
      return;
    }
    if (!pool) {
      return cb(null, { email_enabled: true, sms_enabled: false, push_enabled: true });
    }
    pool
      .query(
        `SELECT email_enabled, sms_enabled, push_enabled FROM notification.user_preferences WHERE user_id = $1::uuid`,
        [userId]
      )
      .then((r) => {
        if (!r.rows.length) {
          return cb(null, { email_enabled: true, sms_enabled: false, push_enabled: true });
        }
        const row = r.rows[0];
        cb(null, {
          email_enabled: !!row.email_enabled,
          sms_enabled: !!row.sms_enabled,
          push_enabled: !!row.push_enabled,
        });
      })
      .catch((e) => {
        console.error("[GetUserPreferences]", e);
        cb({ code: grpc.status.INTERNAL, message: "failed" });
      });
  },
};

export function startGrpcServer(port: number): grpc.Server {
  const server = new grpc.Server();
  server.addService(notifProto.notification.NotificationService.service, handlers);
  registerHealthService(server, "notification.NotificationService", async () => {
    if (!pool) return true;
    try {
      await pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  });

  let credentials: grpc.ServerCredentials;
  try {
    credentials = createOchStrictMtlsServerCredentials("notification gRPC");
    console.log("[notification gRPC] strict mTLS (client cert required)");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  server.bindAsync(`0.0.0.0:${port}`, credentials, (err, boundPort) => {
    if (err) {
      console.error("[notification gRPC] bind error:", err);
      return;
    }
    server.start();
    console.log(`[notification gRPC] listening on ${boundPort}`);
  });

  return server;
}
