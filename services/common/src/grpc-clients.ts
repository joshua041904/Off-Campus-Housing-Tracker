/* cspell:ignore grpc */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import * as fs from "fs";
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
  
  // STRICT TLS: Always require certificates, no insecure fallback
  // For strict TLS with client certificate verification
  if (fs.existsSync(caPath) && fs.existsSync(clientCertPath) && fs.existsSync(clientKeyPath)) {
    const rootCert = fs.readFileSync(caPath);
    const clientCert = fs.readFileSync(clientCertPath);
    const clientKey = fs.readFileSync(clientKeyPath);
    console.log(`[grpc-client] Using STRICT TLS with client certificates: CA=${caPath}, Cert=${clientCertPath}, Key=${clientKeyPath}`);
    // Create credentials with server name override to match certificate
    const credentials = grpc.credentials.createSsl(rootCert, clientKey, clientCert);
    // Note: @grpc/grpc-js doesn't support server name override directly in createSsl
    // We'll need to use channel options instead when creating the client
    return credentials;
  }
  
  // Fallback: CA cert only (no client cert verification) - still STRICT TLS
  if (fs.existsSync(caPath)) {
    const rootCert = fs.readFileSync(caPath);
    console.log(`[grpc-client] Using STRICT TLS with CA certificate only: ${caPath}`);
    return grpc.credentials.createSsl(rootCert);
  }

  // STRICT TLS ENFORCEMENT: Never use insecure, throw error if certs not found
  const errorMsg = `[grpc-client] STRICT TLS REQUIRED: Certificates not found. CA: ${caPath}, Cert: ${clientCertPath}, Key: ${clientKeyPath}. Cannot create insecure connection.`;
  console.error(errorMsg);
  throw new Error(errorMsg);
}

// Load auth proto
const AUTH_PROTO_PATH = resolveProtoPath("auth.proto");
const authPackageDefinition = protoLoader.loadSync(AUTH_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const authProto = grpc.loadPackageDefinition(authPackageDefinition) as any;

// Load records proto
const RECORDS_PROTO_PATH = resolveProtoPath("records.proto");
const recordsPackageDefinition = protoLoader.loadSync(RECORDS_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const recordsProto = grpc.loadPackageDefinition(recordsPackageDefinition) as any;

// Load social proto
const SOCIAL_PROTO_PATH = resolveProtoPath("social.proto");
const socialPackageDefinition = protoLoader.loadSync(SOCIAL_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const socialProto = grpc.loadPackageDefinition(socialPackageDefinition) as any;

// Load listings proto
const LISTINGS_PROTO_PATH = resolveProtoPath("listings.proto");
const listingsPackageDefinition = protoLoader.loadSync(LISTINGS_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const listingsProto = grpc.loadPackageDefinition(listingsPackageDefinition) as any;

// Load shopping proto
const SHOPPING_PROTO_PATH = resolveProtoPath("shopping.proto");
const shoppingPackageDefinition = protoLoader.loadSync(SHOPPING_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const shoppingProto = grpc.loadPackageDefinition(shoppingPackageDefinition) as any;

// Load auction-monitor proto
const AUCTION_MONITOR_PROTO_PATH = resolveProtoPath("auction-monitor.proto");
const auctionMonitorPackageDefinition = protoLoader.loadSync(AUCTION_MONITOR_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const auctionMonitorProto = grpc.loadPackageDefinition(auctionMonitorPackageDefinition) as any;

// Load python-ai proto
const PYTHON_AI_PROTO_PATH = resolveProtoPath("python-ai.proto");
const pythonAiPackageDefinition = protoLoader.loadSync(PYTHON_AI_PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const pythonAiProto = grpc.loadPackageDefinition(pythonAiPackageDefinition) as any;

// Create gRPC clients with proper channel options for TLS server name
function createClientWithOptions(ServiceClass: any, address: string, credentials: grpc.ChannelCredentials) {
  const serverName = process.env.GRPC_SERVER_NAME || process.env.TLS_SERVER_NAME || "off-campus-housing.local";
  // Extract hostname from address (e.g., "auth-service:50051" -> "auth-service")
  const addressHost = address.split(':')[0];
  // If address uses service name, override with certificate hostname
  const options: grpc.ChannelOptions = {};
  if (addressHost.includes('service') || addressHost.includes('-')) {
    // Service name detected, use server name override for certificate validation
    options['grpc.ssl_target_name_override'] = serverName;
  }
  return new ServiceClass(address, credentials, options);
}

// Create gRPC clients
export function createAuthClient(address: string = "auth-service:50051") {
  const AuthService = authProto.auth.AuthService;
  return createClientWithOptions(AuthService, address, buildCredentials());
}

export function createRecordsClient(address: string = "records-service:50051") {
  const RecordsService = recordsProto.records.RecordsService;
  // Use standard credentials (will use TLS if certs exist, insecure otherwise)
  return createClientWithOptions(RecordsService, address, buildCredentials());
}

export function createSocialClient(address: string = "social-service:50056") {
  const SocialService = socialProto.social.SocialService;
  return createClientWithOptions(SocialService, address, buildCredentials());
}

export function createListingsClient(address: string = "listings-service:50057") {
  const ListingsService = listingsProto.listings.ListingsService;
  return createClientWithOptions(ListingsService, address, buildCredentials());
}

export function createShoppingClient(address: string = "shopping-service:50058") {
  const ShoppingService = shoppingProto.shopping.ShoppingService;
  return createClientWithOptions(ShoppingService, address, buildCredentials());
}

export function createAuctionMonitorClient(address: string = "auction-monitor:50059") {
  const AuctionMonitorService = auctionMonitorProto.auction_monitor.AuctionMonitorService;
  return createClientWithOptions(AuctionMonitorService, address, buildCredentials());
}

export function createPythonAIClient(address: string = "python-ai-service:50060") {
  const PythonAIService = pythonAiProto.python_ai.PythonAIService;
  return createClientWithOptions(PythonAIService, address, buildCredentials());
}

// Helper to promisify gRPC calls with timeout, retry logic, and detailed logging
export async function promisifyGrpcCall<T>(
  client: any,
  method: string,
  request: any,
  timeoutMs: number = 10000, // Default 10 second timeout
  maxRetries: number = 3,    // Maximum retry attempts
  retryDelayMs: number = 1000 // Initial retry delay (exponential backoff)
): Promise<T> {
  const serviceName = client?.constructor?.name || "UnknownService";
  const callId = `${serviceName}.${method}.${Date.now()}.${Math.random().toString(36).substr(2, 9)}`;
  
  const attemptCall = (attempt: number): Promise<T> => {
    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      console.log(`[grpc-client] ${callId} Attempt ${attempt}/${maxRetries} - Calling ${serviceName}.${method}`, {
        service: serviceName,
        method,
        attempt,
        maxRetries,
        timeoutMs,
        requestKeys: Object.keys(request || {}),
      });

      let completed = false;
      const timeout = setTimeout(() => {
        if (!completed) {
          completed = true;
          const duration = Date.now() - startTime;
          console.error(`[grpc-client] ${callId} TIMEOUT after ${duration}ms (attempt ${attempt}/${maxRetries})`, {
            service: serviceName,
            method,
            attempt,
            timeoutMs,
            duration,
          });
          reject(new Error(`gRPC call ${method} timed out after ${timeoutMs}ms (attempt ${attempt}/${maxRetries})`));
        }
      }, timeoutMs);

      try {
        // Log client state before call
        const clientState = client?.$channel?.getConnectivityState?.() || "unknown";
        console.log(`[grpc-client] ${callId} Client state before call: ${clientState}`, {
          service: serviceName,
          method,
          clientState,
        });

        client[method](request, (error: any, response: T) => {
          if (completed) return;
          completed = true;
          clearTimeout(timeout);
          const duration = Date.now() - startTime;

          if (error) {
            const errorCode = error?.code || "UNKNOWN";
            const errorMessage = error?.message || String(error);
            const errorDetails = error?.details || "";
            
            console.error(`[grpc-client] ${callId} ERROR (attempt ${attempt}/${maxRetries})`, {
              service: serviceName,
              method,
              attempt,
              errorCode,
              errorMessage,
              errorDetails,
              duration,
              stack: error?.stack,
              // Check for connection-related errors
              isConnectionError: errorCode === "UNAVAILABLE" || 
                                errorCode === "DEADLINE_EXCEEDED" ||
                                errorMessage.includes("ECONNREFUSED") ||
                                errorMessage.includes("No connection established") ||
                                errorMessage.includes("connect") ||
                                errorMessage.includes("Connection"),
            });
            reject(error);
          } else {
            console.log(`[grpc-client] ${callId} SUCCESS (attempt ${attempt}/${maxRetries})`, {
              service: serviceName,
              method,
              attempt,
              duration,
              responseKeys: response ? Object.keys(response as any) : [],
            });
            resolve(response);
          }
        });
      } catch (err: any) {
        if (completed) return;
        completed = true;
        clearTimeout(timeout);
        const duration = Date.now() - startTime;
        console.error(`[grpc-client] ${callId} EXCEPTION (attempt ${attempt}/${maxRetries})`, {
          service: serviceName,
          method,
          attempt,
          error: err?.message || String(err),
          duration,
          stack: err?.stack,
        });
        reject(err);
      }
    });
  };

  // Retry logic with exponential backoff
  let lastError: any = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await attemptCall(attempt);
    } catch (error: any) {
      lastError = error;
      const errorCode = error?.code || "UNKNOWN";
      const errorMessage = error?.message || String(error);
      
      // Check if error is retryable
      const isRetryable = 
        errorCode === "UNAVAILABLE" ||
        errorCode === "DEADLINE_EXCEEDED" ||
        errorCode === "RESOURCE_EXHAUSTED" ||
        errorMessage.includes("ECONNREFUSED") ||
        errorMessage.includes("No connection established") ||
        errorMessage.includes("connect") ||
        errorMessage.includes("Connection") ||
        errorMessage.includes("timeout");

      if (!isRetryable || attempt >= maxRetries) {
        console.error(`[grpc-client] ${callId} NOT RETRYING`, {
          service: serviceName,
          method,
          attempt,
          maxRetries,
          reason: !isRetryable ? "error not retryable" : "max retries reached",
          errorCode,
          errorMessage,
        });
        throw error;
      }

      // Calculate exponential backoff delay
      const delay = retryDelayMs * Math.pow(2, attempt - 1);
      console.warn(`[grpc-client] ${callId} RETRYING after ${delay}ms`, {
        service: serviceName,
        method,
        attempt,
        nextAttempt: attempt + 1,
        maxRetries,
        delay,
        errorCode,
        errorMessage,
      });

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error(`gRPC call ${method} failed after ${maxRetries} attempts`);
}
