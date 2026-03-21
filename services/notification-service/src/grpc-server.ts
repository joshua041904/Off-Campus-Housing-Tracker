import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as fs from "node:fs";
import { registerHealthService, resolveProtoPath } from "@common/utils";
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

  const keyPath = process.env.TLS_KEY_PATH || "/etc/certs/tls.key";
  const certPath = process.env.TLS_CERT_PATH || "/etc/certs/tls.crt";
  const caPath = process.env.TLS_CA_PATH || "/etc/certs/ca.crt";
  const requireClientCert = process.env.GRPC_REQUIRE_CLIENT_CERT === "true";

  let credentials: grpc.ServerCredentials;
  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    const key = fs.readFileSync(keyPath);
    const cert = fs.readFileSync(certPath);
    const rootCerts = fs.existsSync(caPath) ? fs.readFileSync(caPath) : null;
    credentials = grpc.ServerCredentials.createSsl(rootCerts, [{ private_key: key, cert_chain: cert }], requireClientCert as any);
    console.log("[notification gRPC] TLS enabled; client cert required:", requireClientCert);
  } else {
    console.warn("[notification gRPC] TLS certs not found, insecure (dev only)");
    credentials = grpc.ServerCredentials.createInsecure();
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
