/* cspell:ignore grpc */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as fs from "fs";
import * as path from "path";
import { resolveProtoPath } from "./proto.js";

function buildCredentials() {
  const caPath =
    process.env.GRPC_CA_CERT ||
    process.env.INTERNAL_CA_CERT ||
    process.env.SHARED_CA_CERT ||
    process.env.TLS_CA_PATH ||
    "/etc/certs/ca.crt";

  const clientCertPath = process.env.GRPC_CLIENT_CERT || process.env.TLS_CERT_PATH || "/etc/certs/tls.crt";
  const clientKeyPath = process.env.GRPC_CLIENT_KEY || process.env.TLS_KEY_PATH || "/etc/certs/tls.key";

  if (fs.existsSync(caPath) && fs.existsSync(clientCertPath) && fs.existsSync(clientKeyPath)) {
    const rootCert = fs.readFileSync(caPath);
    const clientCert = fs.readFileSync(clientCertPath);
    const clientKey = fs.readFileSync(clientKeyPath);
    console.log(`[grpc-client] Using STRICT TLS with client certificates: CA=${caPath}, Cert=${clientCertPath}, Key=${clientKeyPath}`);
    return grpc.credentials.createSsl(rootCert, clientKey, clientCert);
  }

  if (fs.existsSync(caPath)) {
    const rootCert = fs.readFileSync(caPath);
    console.log(`[grpc-client] Using STRICT TLS with CA certificate only: ${caPath}`);
    return grpc.credentials.createSsl(rootCert);
  }

  const errorMsg = `[grpc-client] STRICT TLS REQUIRED: Certificates not found. CA: ${caPath}, Cert: ${clientCertPath}, Key: ${clientKeyPath}.`;
  console.error(errorMsg);
  throw new Error(errorMsg);
}

const protoRoot = path.dirname(resolveProtoPath("auth.proto"));
const loadOptions: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
  includeDirs: [protoRoot],
};

function loadProto(fileName: string) {
  const fullPath = resolveProtoPath(fileName);
  return grpc.loadPackageDefinition(protoLoader.loadSync(fullPath, loadOptions)) as any;
}

// Housing protos only: auth, listings, booking, messaging, trust, analytics, media
const authProto = loadProto("auth.proto");
const healthProto = loadProto("health.proto");
const listingsProto = loadProto("listings.proto");
const bookingProto = loadProto("booking.proto");
const messagingProto = loadProto("messaging.proto");
const trustProto = loadProto("trust.proto");
const analyticsProto = loadProto("analytics.proto");
const mediaProto = loadProto("media.proto");

/**
 * TLS hostname for certificate verification (grpc.ssl_target_name_override).
 * Kubernetes gRPC targets must use the service DNS name (matches server cert SANs).
 * Do not use GRPC_SERVER_NAME for *.svc.cluster.local — deploys often set it to the public edge host (.test),
 * which breaks mTLS verification (ERR_TLS_CERT_ALTNAME_INVALID).
 */
function resolveGrpcSslTargetName(address: string): string {
  const host = address.split(":")[0];
  if (host.endsWith(".svc.cluster.local")) {
    return host;
  }
  const explicit = process.env.GRPC_SERVER_NAME || process.env.TLS_SERVER_NAME;
  if (explicit) return explicit;
  return "off-campus-housing.test";
}

function createClientWithOptions(ServiceClass: any, address: string, credentials: grpc.ChannelCredentials) {
  const addressHost = address.split(":")[0];
  const serverName = resolveGrpcSslTargetName(address);
  const options: grpc.ChannelOptions = {};
  if (addressHost.includes("service") || addressHost.includes("-")) {
    (options as any)["grpc.ssl_target_name_override"] = serverName;
  }
  return new ServiceClass(address, credentials, options);
}

// Housing ports per README: 50061 auth, 50062 listings, 50063 booking, 50064 messaging, 50066 trust, 50067 analytics, 50068 media
export function createAuthClient(address: string = "auth-service.off-campus-housing-tracker.svc.cluster.local:50061") {
  const AuthService = authProto.auth.AuthService;
  return createClientWithOptions(AuthService, address, buildCredentials());
}

/** grpc.health.v1.Health client — same mTLS channel options as other housing clients. */
export function createGrpcHealthClient(address: string) {
  const Health = healthProto.grpc.health.v1.Health;
  return createClientWithOptions(Health, address, buildCredentials());
}

/**
 * True if Health/Check response status is SERVING.
 * With proto-loader `enums: "String"`, status is often `"SERVING"` not numeric `1`.
 */
export function isGrpcHealthServingStatus(status: unknown): boolean {
  if (status === 1) return true;
  if (status === "SERVING") return true;
  if (typeof status === "string" && status.toUpperCase() === "SERVING") return true;
  return false;
}

/**
 * Mandatory gateway/bootstrap check: dial auth gRPC with mTLS and call Health/Check for auth.AuthService.
 * Fails if TLS/SNI/CA/client cert wrong or auth reports NOT_SERVING (e.g. DB down).
 */
export function verifyAuthGrpcUpstream(
  address: string = process.env.AUTH_GRPC_TARGET || "auth-service.off-campus-housing-tracker.svc.cluster.local:50061",
  serviceName: string = process.env.AUTH_GRPC_HEALTH_SERVICE || "auth.AuthService",
  timeoutMs: number = Number(process.env.AUTH_UPSTREAM_VERIFY_TIMEOUT_MS || "15000")
): Promise<void> {
  const client = createGrpcHealthClient(address);
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new Error(`auth upstream Health/Check timed out after ${timeoutMs}ms (${address})`));
    }, timeoutMs);
    try {
      client.check(
        { service: serviceName },
        (err: grpc.ServiceError | null, response: { status?: number | string } | undefined) => {
          clearTimeout(t);
          if (err) {
            reject(err);
            return;
          }
          const st = response?.status;
          if (!isGrpcHealthServingStatus(st)) {
            reject(
              new Error(
                `auth Health/Check not SERVING for "${serviceName}" (status=${JSON.stringify(st)}). Is auth DB up?`
              )
            );
            return;
          }
          resolve();
        }
      );
    } catch (e) {
      clearTimeout(t);
      reject(e);
    }
  });
}

/**
 * Same as verifyAuthGrpcUpstream but retries until success or total budget exhausted.
 * Use at gateway startup so a simultaneous rollout (auth not ready yet) does not exit(1) immediately.
 *
 * Env: AUTH_UPSTREAM_VERIFY_TOTAL_MS (default 60000), AUTH_UPSTREAM_VERIFY_ATTEMPT_TIMEOUT_MS (default 5000),
 * AUTH_UPSTREAM_VERIFY_INITIAL_BACKOFF_MS (1000), AUTH_UPSTREAM_VERIFY_MAX_BACKOFF_MS (8000).
 */
export async function verifyAuthGrpcUpstreamWithRetry(
  address: string = process.env.AUTH_GRPC_TARGET || "auth-service.off-campus-housing-tracker.svc.cluster.local:50061",
  serviceName: string = process.env.AUTH_GRPC_HEALTH_SERVICE || "auth.AuthService",
  opts?: {
    totalBudgetMs?: number;
    perAttemptTimeoutMs?: number;
    initialBackoffMs?: number;
    maxBackoffMs?: number;
  }
): Promise<void> {
  const totalBudgetMs =
    opts?.totalBudgetMs ?? Number(process.env.AUTH_UPSTREAM_VERIFY_TOTAL_MS || "60000");
  const perAttemptTimeoutMs =
    opts?.perAttemptTimeoutMs ?? Number(process.env.AUTH_UPSTREAM_VERIFY_ATTEMPT_TIMEOUT_MS || "5000");
  const initialBackoffMs =
    opts?.initialBackoffMs ?? Number(process.env.AUTH_UPSTREAM_VERIFY_INITIAL_BACKOFF_MS || "1000");
  const maxBackoffMs =
    opts?.maxBackoffMs ?? Number(process.env.AUTH_UPSTREAM_VERIFY_MAX_BACKOFF_MS || "8000");

  const deadline = Date.now() + totalBudgetMs;
  let attempt = 0;
  let backoff = initialBackoffMs;
  let lastErr: unknown;

  while (Date.now() < deadline) {
    attempt += 1;
    try {
      await verifyAuthGrpcUpstream(address, serviceName, perAttemptTimeoutMs);
      if (attempt > 1) {
        console.log(`[grpc-client] auth upstream verify succeeded on attempt ${attempt}`);
      }
      return;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[grpc-client] auth upstream verify attempt ${attempt} failed: ${msg}`);
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const sleepMs = Math.min(backoff, Math.max(0, remaining));
      await new Promise((r) => setTimeout(r, sleepMs));
      backoff = Math.min(maxBackoffMs, Math.floor(backoff * 1.5));
    }
  }

  if (lastErr instanceof Error) throw lastErr;
  throw new Error(String(lastErr ?? "auth upstream verify failed"));
}

export function createListingsClient(address: string = "listings-service.off-campus-housing-tracker.svc.cluster.local:50062") {
  const ListingsService = listingsProto.listings.ListingsService;
  return createClientWithOptions(ListingsService, address, buildCredentials());
}

export function createBookingClient(address: string = "booking-service.off-campus-housing-tracker.svc.cluster.local:50063") {
  const BookingService = bookingProto.booking.BookingService;
  return createClientWithOptions(BookingService, address, buildCredentials());
}

export function createMessagingClient(address: string = "messaging-service.off-campus-housing-tracker.svc.cluster.local:50064") {
  const MessagingService = messagingProto.messaging.v1.MessagingService;
  return createClientWithOptions(MessagingService, address, buildCredentials());
}

export function createTrustClient(address: string = "trust-service.off-campus-housing-tracker.svc.cluster.local:50066") {
  const TrustService = trustProto.trust.TrustService;
  return createClientWithOptions(TrustService, address, buildCredentials());
}

export function createAnalyticsClient(address: string = "analytics-service.off-campus-housing-tracker.svc.cluster.local:50067") {
  const AnalyticsService = analyticsProto.analytics.AnalyticsService;
  return createClientWithOptions(AnalyticsService, address, buildCredentials());
}

export function createMediaClient(address: string = "media-service.off-campus-housing-tracker.svc.cluster.local:50068") {
  const MediaService = mediaProto.media.MediaService;
  return createClientWithOptions(MediaService, address, buildCredentials());
}

export async function promisifyGrpcCall<T>(
  client: any,
  method: string,
  request: any,
  timeoutMs: number = 10000,
  maxRetries: number = 3,
  retryDelayMs: number = 1000
): Promise<T> {
  const serviceName = client?.constructor?.name || "UnknownService";
  const callId = `${serviceName}.${method}.${Date.now()}.${Math.random().toString(36).substr(2, 9)}`;

  const attemptCall = (attempt: number): Promise<T> => {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      let completed = false;
      const timeout = setTimeout(() => {
        if (!completed) {
          completed = true;
          reject(new Error(`gRPC call ${method} timed out after ${timeoutMs}ms (attempt ${attempt}/${maxRetries})`));
        }
      }, timeoutMs);

      try {
        client[method](request, (error: any, response: T) => {
          if (completed) return;
          completed = true;
          clearTimeout(timeout);
          if (error) reject(error);
          else resolve(response);
        });
      } catch (err: any) {
        if (!completed) {
          completed = true;
          clearTimeout(timeout);
          reject(err);
        }
      }
    });
  };

  let lastError: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await attemptCall(attempt);
    } catch (error: any) {
      lastError = error;
      const errorCode = error?.code || "UNKNOWN";
      const errorMessage = error?.message || String(error);
      const isRetryable =
        errorCode === "UNAVAILABLE" ||
        errorCode === "DEADLINE_EXCEEDED" ||
        errorCode === "RESOURCE_EXHAUSTED" ||
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("connect") ||
        errorMessage.includes("timeout");

      if (!isRetryable || attempt >= maxRetries) throw error;
      await new Promise((r) => setTimeout(r, retryDelayMs * Math.pow(2, attempt - 1)));
    }
  }
  throw lastError || new Error(`gRPC call ${method} failed after ${maxRetries} attempts`);
}
