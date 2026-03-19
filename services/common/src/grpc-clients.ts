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
  const serverName = process.env.GRPC_SERVER_NAME || process.env.TLS_SERVER_NAME || "off-campus-housing.local";

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
const listingsProto = loadProto("listings.proto");
const bookingProto = loadProto("booking.proto");
const messagingProto = loadProto("messaging.proto");
const trustProto = loadProto("trust.proto");
const analyticsProto = loadProto("analytics.proto");
const mediaProto = loadProto("media.proto");

function createClientWithOptions(ServiceClass: any, address: string, credentials: grpc.ChannelCredentials) {
  const serverName = process.env.GRPC_SERVER_NAME || process.env.TLS_SERVER_NAME || "off-campus-housing.local";
  const addressHost = address.split(":")[0];
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
