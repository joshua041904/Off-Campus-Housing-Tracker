/* cspell:ignore grpc */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { signJwt, verifyJwt } from "@common/utils/auth";
import {
  hashPassword,
  comparePassword,
  getQueueStatus,
} from "./lib/bcrypt-queue.js";
import {
  getUserFromCache,
  cacheUser,
  checkEmailExistsInCache,
} from "./lib/redis-cache.js"; // Redis caching with Lua scripts
import { randomUUID } from "node:crypto";
import { resolveProtoPath } from "@common/utils/proto";
import { verifyMFA } from "./lib/mfa.js";
import { prisma } from "./lib/prisma.js"; // Use shared PrismaClient instance
import {
  registerHealthService,
  createOchGrpcServerCredentialsForBind,
} from "@common/utils"; // gRPC health + credentials via createOchGrpcServerCredentialsForBind

// Load proto file
const PROTO_PATH = resolveProtoPath("auth.proto");
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

const authProto = grpc.loadPackageDefinition(packageDefinition) as any;

type GrpcAuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "MISSING_TOKEN"
  | "EXPIRED_TOKEN"
  | "INVALID_TOKEN"
  | "TOKEN_REVOKED"
  | "USER_NOT_FOUND"
  | "ACCOUNT_DELETED"
  | "VALIDATION_ERROR"
  | "EMAIL_ALREADY_EXISTS"
  | "MFA_REQUIRED"
  | "INVALID_MFA_CODE"
  | "INTERNAL_ERROR";

function grpcAuthError(
  status: grpc.status,
  code: GrpcAuthErrorCode,
  message: string,
) {
  return {
    code: status,
    message: JSON.stringify({ code, message }),
  };
}

function classifyGrpcJwtError(err: unknown): {
  code: GrpcAuthErrorCode;
  message: string;
} {
  const name = err instanceof Error ? err.name : "";

  if (name === "TokenExpiredError") {
    return { code: "EXPIRED_TOKEN", message: "Token has expired" };
  }

  return { code: "INVALID_TOKEN", message: "Token is invalid" };
}

type AuthLogLevel = "INFO" | "WARN" | "ERROR";

function logGrpcAuthEvent(
  level: AuthLogLevel,
  event: string,
  data: Record<string, unknown>,
) {
  const entry = {
    service: "auth-service",
    transport: "grpc",
    level,
    event,
    timestamp: new Date().toISOString(),
    ...data,
  };

  if (level === "ERROR") {
    console.error(JSON.stringify(entry));
    return;
  }

  if (level === "WARN") {
    console.warn(JSON.stringify(entry));
    return;
  }

  console.log(JSON.stringify(entry));
}

function getGrpcCallContext(call: any) {
  const metadata = call.metadata?.getMap?.() ?? {};
  return {
    peer: call.getPeer?.() ?? "unknown",
    host: call.host ?? "unknown",
    userAgent:
      typeof metadata["user-agent"] === "string"
        ? metadata["user-agent"]
        : "unknown",
    contentType:
      typeof metadata["content-type"] === "string"
        ? metadata["content-type"]
        : "unknown",
  };
}

// Lightweight middleware: structured + safe, no full header dump
function withLogging(handler: any, methodName: string) {
  return async (call: any, callback: any) => {
    const start = Date.now();
    const ctx = getGrpcCallContext(call);

    logGrpcAuthEvent("INFO", "grpc_request_started", {
      action: methodName,
      ...ctx,
    });

    try {
      await handler(call, callback);

      logGrpcAuthEvent("INFO", "grpc_request_completed", {
        action: methodName,
        durationMs: Date.now() - start,
        ...ctx,
      });
    } catch (err: any) {
      logGrpcAuthEvent("ERROR", "grpc_request_failed", {
        action: methodName,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
        ...ctx,
      });

      callback(
        grpcAuthError(
          grpc.status.INTERNAL,
          "INTERNAL_ERROR",
          "Internal server error",
        ),
      );
    }
  };
}

// Health check service implementation
const healthService = {
  async Check(call: any, callback: any) {
    try {
      let dbOk = false;
      let redisOk = false;
      let cacheStats = { connected: false, userCacheKeys: 0 };
      let queueStatus: {
        activeOperations: number;
        queueLength: number;
        maxConcurrent: number;
        rounds: number;
      } = { activeOperations: 0, queueLength: 0, maxConcurrent: 4, rounds: 8 };

      // Check database
      try {
        const dbCheck = prisma.$queryRaw`SELECT 1`;
        const timeout = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("DB check timeout")), 500),
        );
        await Promise.race([dbCheck, timeout]);
        dbOk = true;
      } catch (e: any) {
        // DB check failed
      }

      // Check Redis
      try {
        const { getRedisClient, getCacheStats } =
          await import("./lib/redis-cache.js");
        const client = getRedisClient();
        if (client && client.isOpen) {
          await client.ping();
          redisOk = true;
          cacheStats = await getCacheStats();
        }
      } catch (e: any) {
        // Redis check failed
      }

      // Get queue status - TypeScript type inference issue workaround
      const queueStatusData: any = getQueueStatus();
      queueStatus.activeOperations = queueStatusData.activeOperations;
      queueStatus.queueLength = queueStatusData.queueLength;
      queueStatus.maxConcurrent = queueStatusData.maxConcurrent;
      queueStatus.rounds = queueStatusData.rounds;

      // Determine overall status - use registerHealthService's ServingStatus enum
      const ServingStatus = {
        UNKNOWN: 0,
        SERVING: 1,
        NOT_SERVING: 2,
        SERVICE_UNKNOWN: 3,
      };
      const healthStatusValue = dbOk
        ? ServingStatus.SERVING
        : ServingStatus.NOT_SERVING;

      callback(null, {
        status: healthStatusValue,
        message: dbOk ? "Service is healthy" : "Database connection failed",
        details: {
          db: dbOk ? "connected" : "disconnected",
          redis: redisOk ? "connected" : "disconnected",
          cache_keys: cacheStats.userCacheKeys.toString(),
          bcrypt_queue: queueStatus.queueLength.toString(),
          bcrypt_active: queueStatus.activeOperations.toString(),
        },
      });
    } catch (error: any) {
      callback({
        code: grpc.status.INTERNAL,
        message: error.message || "health check failed",
      });
    }
  },

  Watch(call: any) {
    // Simple implementation - send periodic health checks
    const interval = setInterval(async () => {
      try {
        let dbOk = false;
        try {
          const dbCheck = prisma.$queryRaw`SELECT 1`;
          const timeout = new Promise((_, reject) =>
            setTimeout(() => reject(new Error("DB check timeout")), 500),
          );
          await Promise.race([dbCheck, timeout]);
          dbOk = true;
        } catch (e: any) {
          // DB check failed
        }

        const ServingStatus = {
          UNKNOWN: 0,
          SERVING: 1,
          NOT_SERVING: 2,
          SERVICE_UNKNOWN: 3,
        };
        const healthStatusValue = dbOk
          ? ServingStatus.SERVING
          : ServingStatus.NOT_SERVING;
        call.write({
          status: healthStatusValue,
          message: dbOk ? "Service is healthy" : "Database connection failed",
        });
      } catch (error: any) {
        call.end();
      }
    }, 5000); // Send health check every 5 seconds

    call.on("end", () => {
      clearInterval(interval);
      call.end();
    });
  },
};

// Implement AuthService
const authService = {
  async Register(call: any, callback: any) {
    const startTime = Date.now();
    const { peer, host, userAgent } = getGrpcCallContext(call);

    try {
      const { email, password } = call.request;

      if (!email || !password) {
        logGrpcAuthEvent("WARN", "register_validation_failed", {
          action: "register",
          emailProvided: Boolean(email),
          passwordProvided: Boolean(password),
          peer,
          host,
          userAgent,
        });

        return callback(
          grpcAuthError(
            grpc.status.INVALID_ARGUMENT,
            "VALIDATION_ERROR",
            "Email and password are required",
          ),
        );
      }

      const checkStart = Date.now();

      const emailExists = await checkEmailExistsInCache(email);
      if (emailExists) {
        logGrpcAuthEvent("WARN", "register_email_already_exists", {
          action: "register",
          peer,
          host,
          userAgent,
          cacheHit: true,
          durationMs: Date.now() - startTime,
        });

        return callback(
          grpcAuthError(
            grpc.status.ALREADY_EXISTS,
            "EMAIL_ALREADY_EXISTS",
            "Email already exists",
          ),
        );
      }

      const existing = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM auth.users WHERE email = ${email} AND COALESCE(is_deleted, false) = false
    `.then((r: Array<any>) => r[0] || null);

      const checkDuration = Date.now() - checkStart;

      if (existing) {
        await cacheUser({
          id: existing.id,
          email,
          passwordHash: "",
          mfaEnabled: false,
          emailVerified: false,
          phoneVerified: false,
          createdAt: new Date(),
        });

        logGrpcAuthEvent("WARN", "register_email_already_exists", {
          action: "register",
          userId: existing.id,
          peer,
          host,
          userAgent,
          cacheHit: false,
          lookupDurationMs: checkDuration,
          durationMs: Date.now() - startTime,
        });

        return callback(
          grpcAuthError(
            grpc.status.ALREADY_EXISTS,
            "EMAIL_ALREADY_EXISTS",
            "Email already exists",
          ),
        );
      }

      const hashStart = Date.now();
      const passwordHash = await hashPassword(password);
      const hashDuration = Date.now() - hashStart;

      if (hashDuration > 5000) {
        logGrpcAuthEvent("WARN", "register_password_hash_slow", {
          action: "register",
          peer,
          host,
          userAgent,
          hashDurationMs: hashDuration,
        });
      }

      const insertStart = Date.now();
      const user = await prisma.$queryRaw<
        Array<{ id: string; email: string; createdAt: Date }>
      >`
      INSERT INTO auth.users (email, password_hash, created_at)
      VALUES (${email}, ${passwordHash}, NOW())
      RETURNING id, email, created_at as "createdAt"
    `.then((r: Array<{ id: string; email: string; createdAt: Date }>) => r[0]);

      const insertDuration = Date.now() - insertStart;

      await cacheUser({
        id: user.id,
        email: user.email,
        passwordHash,
        mfaEnabled: false,
        emailVerified: false,
        phoneVerified: false,
        createdAt: user.createdAt,
      });

      const jti = randomUUID();
      const token = signJwt({ sub: user.id, email: user.email, jti } as any);

      logGrpcAuthEvent("INFO", "register_succeeded", {
        action: "register",
        userId: user.id,
        peer,
        host,
        userAgent,
        lookupDurationMs: checkDuration,
        hashDurationMs: hashDuration,
        insertDurationMs: insertDuration,
        totalDurationMs: Date.now() - startTime,
      });

      callback(null, {
        token,
        user: {
          id: user.id,
          email: user.email,
          created_at: user.createdAt.toISOString(),
        },
      });
    } catch (error: any) {
      logGrpcAuthEvent("ERROR", "register_failed", {
        action: "register",
        peer,
        host,
        userAgent,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });

      callback(
        grpcAuthError(
          grpc.status.INTERNAL,
          "INTERNAL_ERROR",
          "Internal server error",
        ),
      );
    }
  },

  async Authenticate(call: any, callback: any) {
    const startTime = Date.now();
    const { peer, host, userAgent } = getGrpcCallContext(call);

    try {
      const { email, password, mfa_code, mfaCode } = call.request;
      const mfaCodeValue = mfa_code || mfaCode;

      if (!email || !password) {
        logGrpcAuthEvent("WARN", "login_validation_failed", {
          action: "login",
          emailProvided: Boolean(email),
          passwordProvided: Boolean(password),
          peer,
          host,
          userAgent,
        });

        return callback(
          grpcAuthError(
            grpc.status.INVALID_ARGUMENT,
            "VALIDATION_ERROR",
            "Email and password are required",
          ),
        );
      }

      logGrpcAuthEvent("INFO", "login_attempted", {
        action: "login",
        hasMfaCode: Boolean(mfaCodeValue),
        peer,
        host,
        userAgent,
      });

      const cacheStart = Date.now();
      let user = await getUserFromCache(email);
      const cacheDuration = Date.now() - cacheStart;

      if (user) {
        logGrpcAuthEvent("INFO", "login_cache_hit", {
          action: "login",
          userId: user.id,
          cacheDurationMs: cacheDuration,
          peer,
          host,
          userAgent,
        });
      } else {
        logGrpcAuthEvent("INFO", "login_cache_miss", {
          action: "login",
          cacheDurationMs: cacheDuration,
          peer,
          host,
          userAgent,
        });

        const dbUser = await prisma.$queryRaw<
          Array<{
            id: string;
            email: string;
            passwordHash: string;
            mfaEnabled: boolean;
            emailVerified: boolean;
            phoneVerified: boolean;
            createdAt: Date;
          }>
        >`
        SELECT id, email, password_hash as "passwordHash", mfa_enabled as "mfaEnabled",
               email_verified as "emailVerified", phone_verified as "phoneVerified", created_at as "createdAt"
        FROM auth.users
        WHERE email = ${email} AND COALESCE(is_deleted, false) = false
      `.then((r: Array<any>) => r[0] || null);

        if (dbUser) {
          await cacheUser({
            id: dbUser.id,
            email: dbUser.email,
            passwordHash: dbUser.passwordHash,
            mfaEnabled: dbUser.mfaEnabled,
            emailVerified: dbUser.emailVerified,
            phoneVerified: dbUser.phoneVerified,
            createdAt: dbUser.createdAt,
          });
          user = dbUser;
        }
      }

      if (!user || !user.passwordHash) {
        logGrpcAuthEvent("WARN", "login_failed", {
          action: "login",
          reason: "invalid_credentials",
          peer,
          host,
          userAgent,
          durationMs: Date.now() - startTime,
        });

        return callback(
          grpcAuthError(
            grpc.status.UNAUTHENTICATED,
            "INVALID_CREDENTIALS",
            "Invalid email or password",
          ),
        );
      }

      let ok = false;
      try {
        ok = await comparePassword(password, user.passwordHash);
      } catch {
        logGrpcAuthEvent("WARN", "login_failed", {
          action: "login",
          userId: user.id,
          reason: "password_compare_failed",
          peer,
          host,
          userAgent,
          durationMs: Date.now() - startTime,
        });

        return callback(
          grpcAuthError(
            grpc.status.UNAUTHENTICATED,
            "INVALID_CREDENTIALS",
            "Invalid email or password",
          ),
        );
      }

      if (!ok) {
        logGrpcAuthEvent("WARN", "login_failed", {
          action: "login",
          userId: user.id,
          reason: "invalid_credentials",
          peer,
          host,
          userAgent,
          durationMs: Date.now() - startTime,
        });

        return callback(
          grpcAuthError(
            grpc.status.UNAUTHENTICATED,
            "INVALID_CREDENTIALS",
            "Invalid email or password",
          ),
        );
      }

      if (user.mfaEnabled === true) {
        if (!mfaCodeValue) {
          logGrpcAuthEvent("INFO", "login_mfa_required", {
            action: "login",
            userId: user.id,
            peer,
            host,
            userAgent,
            durationMs: Date.now() - startTime,
          });

          callback(null, {
            token: "",
            refresh_token: "",
            requires_mfa: true,
            user_id: user.id,
            message: "MFA code required",
            user: {
              id: user.id,
              email: user.email,
              created_at: user.createdAt.toISOString(),
            },
          });
          return;
        }

        const mfaValid = await verifyMFA(prisma, user.id, mfaCodeValue);
        if (!mfaValid) {
          logGrpcAuthEvent("WARN", "login_failed", {
            action: "login",
            userId: user.id,
            reason: "invalid_mfa_code",
            peer,
            host,
            userAgent,
            durationMs: Date.now() - startTime,
          });

          return callback(
            grpcAuthError(
              grpc.status.UNAUTHENTICATED,
              "INVALID_MFA_CODE",
              "Invalid MFA code",
            ),
          );
        }
      }

      const jti = randomUUID();
      const token = signJwt({ sub: user.id, email: user.email, jti } as any);

      logGrpcAuthEvent("INFO", "login_succeeded", {
        action: "login",
        userId: user.id,
        peer,
        host,
        userAgent,
        durationMs: Date.now() - startTime,
      });

      callback(null, {
        token,
        refresh_token: "",
        requires_mfa: false,
        user: {
          id: user.id,
          email: user.email,
          created_at: user.createdAt.toISOString(),
        },
      });
    } catch (error: any) {
      const msg = (error?.message ?? String(error)).toLowerCase();
      const code = error?.code ?? "";

      if (
        code === "P2025" ||
        msg.includes("not found") ||
        msg.includes("record not found") ||
        msg.includes("invalid") ||
        msg.includes("credential")
      ) {
        logGrpcAuthEvent("WARN", "login_failed", {
          action: "login",
          reason: "invalid_credentials",
          peer,
          host,
          userAgent,
          durationMs: Date.now() - startTime,
        });

        return callback(
          grpcAuthError(
            grpc.status.UNAUTHENTICATED,
            "INVALID_CREDENTIALS",
            "Invalid email or password",
          ),
        );
      }

      logGrpcAuthEvent("ERROR", "login_failed", {
        action: "login",
        reason: "internal_error",
        peer,
        host,
        userAgent,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });

      callback(
        grpcAuthError(
          grpc.status.INTERNAL,
          "INTERNAL_ERROR",
          "Internal server error",
        ),
      );
    }
  },

  async ValidateToken(call: any, callback: any) {
    const startTime = Date.now();
    const { peer, host, userAgent } = getGrpcCallContext(call);

    try {
      const { token } = call.request;
      if (!token) {
        logGrpcAuthEvent("WARN", "validate_token_failed", {
          action: "validate_token",
          reason: "missing_token",
          peer,
          host,
          userAgent,
        });

        return callback(
          grpcAuthError(
            grpc.status.INVALID_ARGUMENT,
            "MISSING_TOKEN",
            "Token is required",
          ),
        );
      }

      const payload = verifyJwt(token) as any;
      const userId = payload.sub;

      if (!userId) {
        logGrpcAuthEvent("WARN", "validate_token_failed", {
          action: "validate_token",
          reason: "invalid_token",
          peer,
          host,
          userAgent,
          durationMs: Date.now() - startTime,
        });

        return callback(
          grpcAuthError(
            grpc.status.UNAUTHENTICATED,
            "INVALID_TOKEN",
            "Token is invalid",
          ),
        );
      }

      const jti = payload.jti;
      if (jti) {
        const { getRedisClient } = await import("./lib/redis-cache.js");
        const redis = getRedisClient();
        if (redis) {
          try {
            const revoked = await redis.get(`revoked:${jti}`);
            if (revoked) {
              logGrpcAuthEvent("WARN", "validate_token_failed", {
                action: "validate_token",
                sub: userId,
                reason: "token_revoked",
                peer,
                host,
                userAgent,
                durationMs: Date.now() - startTime,
              });

              return callback(
                grpcAuthError(
                  grpc.status.UNAUTHENTICATED,
                  "TOKEN_REVOKED",
                  "Token has been revoked",
                ),
              );
            }
          } catch (redisErr) {
            logGrpcAuthEvent("WARN", "validate_token_redis_check_failed", {
              action: "validate_token",
              sub: userId,
              peer,
              host,
              userAgent,
              error:
                redisErr instanceof Error ? redisErr.message : String(redisErr),
            });
          }
        }
      }

      const user = await prisma.$queryRaw<
        Array<{
          id: string;
          email: string | null;
          createdAt: Date;
          isDeleted: boolean;
        }>
      >`
      SELECT id, email, created_at as "createdAt", COALESCE(is_deleted, false) as "isDeleted"
      FROM auth.users
      WHERE id = ${userId}::uuid
    `.then(
        (
          r: Array<{
            id: string;
            email: string | null;
            createdAt: Date;
            isDeleted: boolean;
          }>,
        ) => r[0] || null,
      );

      if (!user) {
        logGrpcAuthEvent("WARN", "validate_token_failed", {
          action: "validate_token",
          sub: userId,
          reason: "user_not_found",
          peer,
          host,
          userAgent,
          durationMs: Date.now() - startTime,
        });

        return callback(
          grpcAuthError(
            grpc.status.UNAUTHENTICATED,
            "USER_NOT_FOUND",
            "User not found",
          ),
        );
      }

      if (user.isDeleted) {
        logGrpcAuthEvent("WARN", "validate_token_failed", {
          action: "validate_token",
          sub: userId,
          reason: "account_deleted",
          peer,
          host,
          userAgent,
          durationMs: Date.now() - startTime,
        });

        return callback(
          grpcAuthError(
            grpc.status.UNAUTHENTICATED,
            "ACCOUNT_DELETED",
            "Account has been deleted",
          ),
        );
      }

      logGrpcAuthEvent("INFO", "validate_token_succeeded", {
        action: "validate_token",
        userId: user.id,
        peer,
        host,
        userAgent,
        durationMs: Date.now() - startTime,
      });

      callback(null, {
        valid: true,
        user: {
          id: user.id,
          email: user.email,
          created_at: user.createdAt.toISOString(),
        },
      });
    } catch (error: any) {
      const jwtErr = classifyGrpcJwtError(error);

      logGrpcAuthEvent("WARN", "validate_token_failed", {
        action: "validate_token",
        reason: jwtErr.code,
        peer,
        host,
        userAgent,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });

      callback(
        grpcAuthError(grpc.status.UNAUTHENTICATED, jwtErr.code, jwtErr.message),
      );
    }
  },

  async RefreshToken(call: any, callback: any) {
    const startTime = Date.now();
    const { peer, host, userAgent } = getGrpcCallContext(call);

    try {
      const token = call.request.refresh_token || call.request.token;
      if (!token) {
        logGrpcAuthEvent("WARN", "refresh_validation_failed", {
          action: "refresh",
          peer,
          host,
          userAgent,
          requestKeys: Object.keys(call.request ?? {}),
        });

        return callback(
          grpcAuthError(
            grpc.status.INVALID_ARGUMENT,
            "MISSING_TOKEN",
            "Token is required",
          ),
        );
      }

      const payload = verifyJwt(token) as any;
      const userId = payload.sub;

      if (!userId) {
        logGrpcAuthEvent("WARN", "refresh_failed", {
          action: "refresh",
          reason: "invalid_token",
          peer,
          host,
          userAgent,
          durationMs: Date.now() - startTime,
        });

        return callback(
          grpcAuthError(
            grpc.status.UNAUTHENTICATED,
            "INVALID_TOKEN",
            "Token is invalid",
          ),
        );
      }

      const jti = payload.jti;
      if (jti) {
        const { getRedisClient } = await import("./lib/redis-cache.js");
        const redis = getRedisClient();
        if (redis) {
          try {
            const revoked = await redis.get(`revoked:${jti}`);
            if (revoked) {
              logGrpcAuthEvent("WARN", "refresh_failed", {
                action: "refresh",
                sub: userId,
                reason: "token_revoked",
                peer,
                host,
                userAgent,
                durationMs: Date.now() - startTime,
              });

              return callback(
                grpcAuthError(
                  grpc.status.UNAUTHENTICATED,
                  "TOKEN_REVOKED",
                  "Token has been revoked",
                ),
              );
            }
          } catch (redisErr) {
            logGrpcAuthEvent("WARN", "refresh_redis_check_failed", {
              action: "refresh",
              sub: userId,
              peer,
              host,
              userAgent,
              error:
                redisErr instanceof Error ? redisErr.message : String(redisErr),
            });
          }
        }
      }

      const user = await prisma.$queryRaw<
        Array<{ id: string; email: string | null; isDeleted: boolean }>
      >`
      SELECT id, email, COALESCE(is_deleted, false) as "isDeleted"
      FROM auth.users
      WHERE id = ${userId}::uuid
    `.then(
        (r: Array<{ id: string; email: string | null; isDeleted: boolean }>) =>
          r[0] || null,
      );

      if (!user) {
        logGrpcAuthEvent("WARN", "refresh_failed", {
          action: "refresh",
          sub: userId,
          reason: "user_not_found",
          peer,
          host,
          userAgent,
          durationMs: Date.now() - startTime,
        });

        return callback(
          grpcAuthError(
            grpc.status.UNAUTHENTICATED,
            "USER_NOT_FOUND",
            "User not found",
          ),
        );
      }

      if (user.isDeleted) {
        logGrpcAuthEvent("WARN", "refresh_failed", {
          action: "refresh",
          sub: userId,
          reason: "account_deleted",
          peer,
          host,
          userAgent,
          durationMs: Date.now() - startTime,
        });

        return callback(
          grpcAuthError(
            grpc.status.UNAUTHENTICATED,
            "ACCOUNT_DELETED",
            "Account has been deleted",
          ),
        );
      }

      const newJti = randomUUID();
      const newPayload: any = {
        sub: user.id,
        email: user.email ?? "",
        jti: newJti,
      };
      const newToken = signJwt(newPayload);

      logGrpcAuthEvent("INFO", "refresh_succeeded", {
        action: "refresh",
        sub: user.id,
        peer,
        host,
        userAgent,
        durationMs: Date.now() - startTime,
      });

      callback(null, {
        token: newToken,
      });
    } catch (error: any) {
      const jwtErr = classifyGrpcJwtError(error);

      logGrpcAuthEvent("WARN", "refresh_failed", {
        action: "refresh",
        reason: jwtErr.code,
        peer,
        host,
        userAgent,
        durationMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : String(error),
      });

      callback(
        grpcAuthError(grpc.status.UNAUTHENTICATED, jwtErr.code, jwtErr.message),
      );
    }
  },

  async HealthCheck(call: any, callback: any) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      callback(null, {
        healthy: true,
        version: process.env.SERVICE_VERSION || "1.0.0",
      });
    } catch (error: any) {
      console.error("[gRPC] HealthCheck error:", error);
      callback(null, {
        healthy: false,
        version: process.env.SERVICE_VERSION || "1.0.0",
      });
    }
  },
};

// Create and start gRPC server with HTTP/2 only
// @grpc/grpc-js uses HTTP/2 internally, we just need to configure it properly
export function startGrpcServer(port: number = 50051) {
  const server = new grpc.Server({
    // Force HTTP/2 only - no HTTP/1.1 fallback
    "grpc.keepalive_time_ms": 30000,
    "grpc.keepalive_timeout_ms": 5000,
    "grpc.keepalive_permit_without_calls": 1,
    "grpc.http2.max_pings_without_data": 0,
    "grpc.http2.min_time_between_pings_ms": 10000,
    "grpc.http2.min_ping_interval_without_data_ms": 300000,
  });

  server.addService(authProto.auth.AuthService.service, {
    Register: withLogging(authService.Register, "Register"),
    Authenticate: withLogging(authService.Authenticate, "Authenticate"),
    ValidateToken: withLogging(authService.ValidateToken, "ValidateToken"),
    RefreshToken: withLogging(authService.RefreshToken, "RefreshToken"),
    HealthCheck: withLogging(authService.HealthCheck, "HealthCheck"),
  });

  // Register standard gRPC Health Service (grpc.health.v1.Health)
  // This enables health checks via: grpc.health.v1.Health/Check
  registerHealthService(server, "auth.AuthService", async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (err) {
      console.error("[gRPC] Health check failed:", err);
      return false;
    }
  });

  // Enable gRPC reflection for tooling (grpcurl, etc.)
  if (process.env.ENABLE_GRPC_REFLECTION !== "false") {
    try {
      const { enableReflection } = require("@common/utils/grpc-reflection");
      enableReflection(server, [PROTO_PATH], ["auth.AuthService"]);
    } catch (err) {
      console.warn("[gRPC] Failed to enable reflection:", err);
    }
  }

  let credentials: grpc.ServerCredentials;
  try {
    credentials = createOchGrpcServerCredentialsForBind("auth gRPC");
    console.log("[gRPC] strict mTLS (client cert required)");
  } catch (e) {
    console.error(e);
    process.exit(1);
  }

  server.bindAsync(`0.0.0.0:${port}`, credentials, (error, actualPort) => {
    if (error) {
      console.error("[gRPC] Server bind error:", error);
      return;
    }
    console.log(
      `[gRPC] Server started on port ${actualPort} (HTTP/2 only, no HTTP/1.1 fallback)`,
    );
  });

  return server;
}
