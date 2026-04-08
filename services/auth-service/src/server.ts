/* cspell:ignore healthz */
import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import {
  register,
  httpCounter,
  createHttpConcurrencyGuard,
  encodeUserAccountDeletedEnvelope,
  USER_ACCOUNT_DELETED_V1,
  userLifecycleV1Topic,
} from "@common/utils";
import {
  signJwt,
  verifyJwt,
  type JwtPayload as TokenPayload,
} from "@common/utils/auth";
import { randomUUID } from "node:crypto";
import { createClient } from "redis";
import { setupOAuthRoutes } from "./routes/oauth.js";
import { setupVerificationRoutes } from "./routes/verification.js";
import passkeyRouter from "./routes/passkey.js";
import { getMockSmsProvider } from "./lib/sms-providers.js";
import { prisma } from "./lib/prisma.js"; // Use shared PrismaClient instance
import {
  hashPassword,
  comparePassword,
  getQueueStatus,
} from "./lib/bcrypt-queue.js"; // Use queued bcrypt operations
import {
  getUserFromCache,
  cacheUser,
  invalidateUserCache,
  checkEmailExistsInCache,
} from "./lib/redis-cache.js"; // Redis caching with Lua scripts

const app = express();
// Prisma is now imported from shared module to avoid connection pool exhaustion

/** Extend the shared JwtPayload with fields we also put/read */
type WithJti = TokenPayload & { jti?: string; exp?: number };

type AuthErrorCode =
  | "INVALID_CREDENTIALS"
  | "MISSING_TOKEN"
  | "EXPIRED_TOKEN"
  | "INVALID_TOKEN"
  | "TOKEN_REVOKED"
  | "USER_NOT_FOUND"
  | "ACCOUNT_DELETED"
  | "VALIDATION_ERROR"
  | "EMAIL_ALREADY_EXISTS"
  | "FORBIDDEN"
  | "INTERNAL_ERROR";

function authError(code: AuthErrorCode, message: string) {
  return { code, message };
}

function sendAuthError(
  res: Response,
  status: number,
  code: AuthErrorCode,
  message: string,
  extra?: Record<string, unknown>,
) {
  return res.status(status).json({
    ...authError(code, message),
    ...(extra ?? {}),
  });
}

function classifyJwtError(err: unknown): {
  code: AuthErrorCode;
  message: string;
} {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);

  if (name === "TokenExpiredError") {
    return { code: "EXPIRED_TOKEN", message: "Token has expired" };
  }

  return {
    code: "INVALID_TOKEN",
    message: message?.toLowerCase().includes("jwt")
      ? "Token is invalid"
      : "Token is invalid",
  };
}

// --- Redis (revocation list) ---
// Support both REDIS_URL (with password) and REDIS_PASSWORD env var. Empty = no auth (externalized Redis).
let REDIS_URL = process.env.REDIS_URL || "redis://redis:6379/0";
const rawRedisPassword = process.env.REDIS_PASSWORD;
const REDIS_PASSWORD =
  rawRedisPassword && String(rawRedisPassword).trim()
    ? rawRedisPassword
    : undefined;
// If REDIS_PASSWORD is set and URL doesn't have password, add it
if (REDIS_PASSWORD && !REDIS_URL.includes("@") && !REDIS_URL.includes("://:")) {
  // Insert password after redis://
  REDIS_URL = REDIS_URL.replace("redis://", `redis://:${REDIS_PASSWORD}@`);
}
const redis = createClient({
  url: REDIS_URL,
  socket: { connectTimeout: 10_000 }, // Colima/host.docker.internal may need a moment on first packet
});
redis.on("error", (e: unknown) =>
  console.error("auth-service redis error:", e),
);
(async () => {
  try {
    await redis.connect();
    console.log("auth-service redis connected");
  } catch (e) {
    console.error("auth-service redis connect failed:", e);
  }
})();

app.use(express.json({ limit: "1mb" }));

// metrics
app.use((req: Request, res: Response, next: NextFunction) => {
  res.on("finish", () =>
    httpCounter.inc({
      service: "auth",
      route: req.path,
      method: req.method,
      code: res.statusCode,
    }),
  );
  next();
});

app.get("/metrics", async (_req: Request, res: Response) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.get("/healthz", async (_req: Request, res: Response) => {
  let dbOk = false;
  let redisOk = false;

  // Check database (non-blocking, with timeout)
  try {
    // Use Promise.race to add a timeout to the database query
    const dbCheck = prisma.$queryRaw`SELECT 1`;
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("DB check timeout")), 500),
    );
    await Promise.race([dbCheck, timeout]);
    dbOk = true;
  } catch (e: any) {
    // Silently fail - don't log timeout errors to reduce noise
    if (!e?.message?.includes("timeout")) {
      console.warn(
        "auth-service healthz db check failed:",
        e?.message || "db error",
      );
    }
  }

  // Check Redis (non-blocking, with timeout)
  try {
    const redisCheck = redis.ping();
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Redis check timeout")), 500),
    );
    await Promise.race([redisCheck, timeout]);
    redisOk = true;
  } catch (redisErr: any) {
    // Silently fail - don't log timeout errors to reduce noise
    if (!redisErr?.message?.includes("timeout")) {
      console.warn("auth-service healthz redis ping failed:", redisErr);
    }
  }

  // Include bcrypt queue status and cache stats in health check
  const { getCacheStats } = await import("./lib/redis-cache.js");
  // @ts-ignore - TypeScript incorrectly infers nested type from bcryptjs
  const queueStatusData: any = getQueueStatus();
  // @ts-ignore - TypeScript type inference issue (bcryptjs nested type)
  const queueStatus = {
    activeOperations: queueStatusData.activeOperations,
    queueLength: queueStatusData.queueLength,
    maxConcurrent: queueStatusData.maxConcurrent,
    rounds: queueStatusData.rounds,
  } as any;
  const cacheStats = await getCacheStats();

  // Return 200 immediately - allows service to start and gRPC to be available
  // The service can still handle requests, they'll just fail if DB is down
  res.status(200).json({
    ok: true,
    db: dbOk ? "connected" : "disconnected",
    redis: redisOk ? "connected" : "disconnected",
    bcrypt: {
      activeOperations: queueStatus.activeOperations,
      queueLength: queueStatus.queueLength,
      maxConcurrent: queueStatus.maxConcurrent,
      rounds: queueStatus.rounds,
    },
    cache: cacheStats,
  });
});

app.use(
  createHttpConcurrencyGuard({
    envVar: "AUTH_HTTP_MAX_CONCURRENT",
    defaultMax: 60,
    serviceLabel: "auth-service",
  }),
);

app.post("/register", async (req: Request, res: Response) => {
  try {
    const { email, password, sendVerification } = (req.body ?? {}) as {
      email?: string;
      password?: string;
      sendVerification?: boolean;
    };
    if (!email || !password) {
      return sendAuthError(
        res,
        400,
        "VALIDATION_ERROR",
        "Email and password are required",
      );
    }

    // Check cache first for email existence (fast path)
    const emailExists = await checkEmailExistsInCache(email);
    if (emailExists) {
      return sendAuthError(
        res,
        409,
        "EMAIL_ALREADY_EXISTS",
        "Email already exists",
      );
    }

    // Use raw SQL query to access auth.users table directly
    const existing = await prisma.$queryRaw<
      Array<{ id: string; email: string }>
    >`
      SELECT id, email FROM auth.users
      WHERE email = ${email} AND COALESCE(is_deleted, false) = false
    `.then((r: Array<any>) => r[0] || null);
    if (existing) {
      // Cache the existing user for future lookups
      await cacheUser({
        id: existing.id,
        email: existing.email,
        passwordHash: "", // Don't cache password hash for existing check
        mfaEnabled: false,
        emailVerified: false,
        phoneVerified: false,
        createdAt: new Date(),
      });
      return sendAuthError(
        res,
        409,
        "EMAIL_ALREADY_EXISTS",
        "Email already exists",
      );
    }

    // Use queued bcrypt to prevent CPU contention
    const hashStart = Date.now();
    const hash = await hashPassword(password);
    const hashDuration = Date.now() - hashStart;
    if (hashDuration > 5000) {
      console.warn(
        `[auth] Slow bcrypt.hash: ${hashDuration}ms (queue may be backed up)`,
      );
    }
    const user = await prisma.$queryRaw<
      Array<{ id: string; email: string; created_at: Date }>
    >`
      INSERT INTO auth.users (email, password_hash, email_verified, created_at)
      VALUES (${email}, ${hash}, ${sendVerification ? false : true}, NOW())
      RETURNING id, email, created_at
    `.then((r: Array<{ id: string; email: string; created_at: Date }>) => r[0]);

    // Cache the newly created user
    await cacheUser({
      id: user.id,
      email: user.email,
      passwordHash: hash,
      mfaEnabled: false,
      emailVerified: !sendVerification,
      phoneVerified: false,
      createdAt: user.created_at,
    });

    // Send verification email if requested
    if (sendVerification) {
      try {
        const { sendEmailVerificationCode } =
          await import("./lib/verification.js");
        await sendEmailVerificationCode(prisma, user.id, email);
      } catch (e) {
        console.warn("Failed to send verification email:", e);
        // Continue anyway - user is registered
      }
    }

    const jti = randomUUID();
    const payload: WithJti = { sub: user.id, email: user.email, jti };
    const token = signJwt(payload);
    res.status(201).json({
      token,
      emailVerified: !sendVerification,
      message: sendVerification ? "Verification email sent" : undefined,
    });
  } catch (e: any) {
    console.error("register error:", e);
    return sendAuthError(res, 500, "INTERNAL_ERROR", "Internal server error");
  }
});

app.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = (req.body ?? {}) as {
      email?: string;
      password?: string;
    };
    if (!email || !password) {
      return sendAuthError(
        res,
        400,
        "VALIDATION_ERROR",
        "Email and password are required",
      );
    }

    console.log(`[LOGIN] Login attempt for email: ${email}`);

    // Try cache first (fast path)
    const cacheStart = Date.now();
    let user = await getUserFromCache(email);
    const cacheDuration = Date.now() - cacheStart;

    if (user) {
      console.log(`[LOGIN] User found in cache (hit) took ${cacheDuration}ms`);
    } else {
      console.log(
        `[LOGIN] Cache miss, fetching from database (took ${cacheDuration}ms)`,
      );
      // Cache miss - fetch from database
      const dbUser = await prisma.$queryRaw<
        Array<{
          id: string;
          email: string;
          passwordHash: string;
          mfaEnabled: boolean;
          emailVerified: boolean;
          phoneVerified: boolean;
          createdAt: Date;
          isDeleted: boolean;
        }>
      >`
        SELECT id, email, password_hash as "passwordHash", mfa_enabled as "mfaEnabled",
               email_verified as "emailVerified", phone_verified as "phoneVerified", created_at as "createdAt",
               COALESCE(is_deleted, false) as "isDeleted"
        FROM auth.users
        WHERE email = ${email} AND COALESCE(is_deleted, false) = false
      `.then((r: Array<any>) => r[0] || null);

      if (dbUser) {
        // Cache the user for future lookups
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

    if (!user) console.log(`[LOGIN] User not found for email: ${email}`);
    if (!user || !user.passwordHash) {
      // User doesn't exist or has no password - return 401 (not 500)
      return sendAuthError(
        res,
        401,
        "INVALID_CREDENTIALS",
        "Invalid email or password",
      );
    }

    // Use queued bcrypt compare (faster than hash). Catch throws (e.g. corrupt hash) so we return 401, not 500.
    let ok = false;
    try {
      ok = await comparePassword(password, user.passwordHash);
    } catch (_) {
      return sendAuthError(
        res,
        401,
        "INVALID_CREDENTIALS",
        "Invalid email or password",
      );
    }
    if (!ok)
      return sendAuthError(
        res,
        401,
        "INVALID_CREDENTIALS",
        "Invalid email or password",
      );

    // MFA/passkeys disabled for this setup — issue token after password check
    const jti = randomUUID();
    const payload: WithJti = { sub: user.id, email: user.email, jti };
    const token = signJwt(payload);
    res.json({ token });
  } catch (e: any) {
    console.error("login error:", e);
    // Return 401 for credential/not-found errors so we never leak 500 for auth failures (e.g. deleted user, DB blip)
    const msg = (e?.message ?? String(e)).toLowerCase();
    const code = e?.code ?? "";
    if (
      code === "P2025" ||
      msg.includes("not found") ||
      msg.includes("record not found") ||
      msg.includes("invalid") ||
      msg.includes("credential")
    ) {
      return sendAuthError(
        res,
        401,
        "INVALID_CREDENTIALS",
        "Invalid email or password",
      );
    }
    return sendAuthError(res, 500, "INTERNAL_ERROR", "Internal server error");
  }
});

/**
 * Server-side logout (token revocation):
 * - Reads Authorization: Bearer <token>
 * - Verifies it, extracts jti and exp
 * - Stores jti in Redis with TTL = exp - now (or 24h fallback if exp missing)
 * - Returns 204 (idempotent)
 */
app.post("/logout", async (req: Request, res: Response) => {
  const raw = req.headers.authorization?.split(" ")[1];
  if (!raw) return res.status(200).json({ ok: true, revoked: false });

  try {
    const payload = verifyJwt(raw) as WithJti;
    if (payload.jti) {
      const now = Math.floor(Date.now() / 1000);
      const exp =
        typeof payload.exp === "number" ? payload.exp : now + 24 * 60 * 60; // fallback 24h
      const ttl = Math.max(1, exp - now);
      try {
        await redis.set(`revoked:${payload.jti}`, "1", { EX: ttl });
        console.log("auth-service: revoked jti", payload.jti, "ttl", ttl, "s");
        return res.status(200).json({ ok: true, revoked: true });
      } catch (redisErr) {
        console.error(
          "auth-service: failed to revoke token in Redis:",
          redisErr,
        );
        // Still return 200 but indicate revocation failed
        return res
          .status(200)
          .json({ ok: true, revoked: false, error: "Redis unavailable" });
      }
    }
    return res.status(200).json({ ok: true, revoked: false });
  } catch (err) {
    console.error("auth-service: logout error:", err);
    return res.status(200).json({ ok: true, revoked: false });
  }
});

/**
 * Token validation endpoint (HTTP)
 * - Validates a JWT token and returns user info if valid
 * - Checks token revocation status in Redis
 * - Returns 200 with user info if valid, 401 if invalid
 */
app.post("/validate", async (req: Request, res: Response) => {
  const auth = req.headers.authorization?.split(" ")[1];
  if (!auth) {
    return sendAuthError(
      res,
      401,
      "MISSING_TOKEN",
      "Authorization token is required",
      {
        valid: false,
      },
    );
  }

  try {
    const payload = verifyJwt(auth) as WithJti;
    const userId = payload.sub;

    if (!userId) {
      return sendAuthError(res, 401, "INVALID_TOKEN", "Token is invalid", {
        valid: false,
      });
    }

    // Check if token is revoked
    const jti = payload.jti;
    if (jti) {
      const revoked = await redis.get(`revoked:${jti}`);
      if (revoked) {
        return sendAuthError(
          res,
          401,
          "TOKEN_REVOKED",
          "Token has been revoked",
          { valid: false },
        );
      }
    }

    // Verify user exists
    const user = await prisma.$queryRaw<
      Array<{
        id: string;
        email: string | null;
        created_at: Date;
        is_deleted: boolean;
      }>
    >`
      SELECT id, email, created_at, COALESCE(is_deleted, false) as is_deleted
      FROM auth.users
      WHERE id = ${userId}::uuid
    `.then(
      (
        r: Array<{
          id: string;
          email: string | null;
          created_at: Date;
          is_deleted: boolean;
        }>,
      ) => r[0] || null,
    );

    if (!user) {
      return sendAuthError(res, 401, "USER_NOT_FOUND", "User not found", {
        valid: false,
      });
    }
    if (user.is_deleted) {
      return sendAuthError(
        res,
        401,
        "ACCOUNT_DELETED",
        "Account has been deleted",
        {
          valid: false,
        },
      );
    }

    return res.status(200).json({
      valid: true,
      user: {
        id: user.id,
        email: user.email,
        created_at: user.created_at.toISOString(),
      },
    });
  } catch (err) {
    console.error("auth-service: validate token error:", err);
    const jwtErr = classifyJwtError(err);
    return sendAuthError(res, 401, jwtErr.code, jwtErr.message, {
      valid: false,
    });
  }
});

// Token refresh endpoint (HTTP) - returns new token with same user
app.post("/refresh", async (req: Request, res: Response) => {
  const auth = req.headers.authorization?.split(" ")[1];
  if (!auth) {
    return sendAuthError(
      res,
      401,
      "MISSING_TOKEN",
      "Authorization token is required",
    );
  }

  try {
    const payload = verifyJwt(auth) as WithJti;
    const userId = payload.sub;

    if (!userId) {
      return sendAuthError(res, 401, "INVALID_TOKEN", "Token is invalid");
    }

    // Check if token is revoked
    const jti = payload.jti;
    if (jti) {
      const revoked = await redis.get(`revoked:${jti}`);
      if (revoked) {
        return sendAuthError(
          res,
          401,
          "TOKEN_REVOKED",
          "Token has been revoked",
        );
      }
    }

    // Verify user exists
    const user = await prisma.$queryRaw<
      Array<{ id: string; email: string | null; is_deleted: boolean }>
    >`
      SELECT id, email, COALESCE(is_deleted, false) as is_deleted
      FROM auth.users
      WHERE id = ${userId}::uuid
    `.then(
      (r: Array<{ id: string; email: string | null; is_deleted: boolean }>) =>
        r[0] || null,
    );

    if (!user) {
      return sendAuthError(res, 401, "USER_NOT_FOUND", "User not found");
    }
    if (user.is_deleted) {
      return sendAuthError(
        res,
        401,
        "ACCOUNT_DELETED",
        "Account has been deleted",
      );
    }

    // Generate new token
    const newJti = randomUUID();
    const newPayload: WithJti = {
      sub: user.id,
      email: user.email ?? "",
      jti: newJti,
    };
    const newToken = signJwt(newPayload);

    return res.status(200).json({ token: newToken });
  } catch (err) {
    console.error("auth-service: refresh token error:", err);
    const jwtErr = classifyJwtError(err);
    return sendAuthError(res, 401, jwtErr.code, jwtErr.message);
  }
});

/**
 * Delete account: soft delete + PII purge + transactional outbox row (user.account.deleted.v1).
 * Kafka send runs in background publisher. Idempotent: second call returns already_deleted (same JWT OK).
 */
app.delete("/account", async (req: Request, res: Response) => {
  const auth = req.headers.authorization?.split(" ")[1];
  if (!auth)
    return sendAuthError(
      res,
      401,
      "MISSING_TOKEN",
      "Authorization token is required",
    );

  try {
    const payload = verifyJwt(auth) as WithJti;
    const userId = payload.sub;

    if (!userId) {
      return sendAuthError(res, 401, "INVALID_TOKEN", "Token is invalid");
    }

    const row = await prisma.$queryRaw<
      Array<{ email: string | null; is_deleted: boolean }>
    >`
      SELECT email, COALESCE(is_deleted, false) as is_deleted
      FROM auth.users WHERE id = ${userId}::uuid
    `.then((r) => r[0] || null);

    if (!row) {
      return sendAuthError(res, 404, "USER_NOT_FOUND", "User not found");
    }

    if (row.is_deleted) {
      return res
        .status(202)
        .json({ status: "already_deleted", user_id: userId });
    }

    const jti = payload.jti;
    if (jti) {
      try {
        const revoked = await redis.get(`revoked:${jti}`);
        if (revoked) {
          return sendAuthError(
            res,
            401,
            "TOKEN_REVOKED",
            "Token has been revoked",
          );
        }
      } catch {
        /* continue */
      }
    }

    const topic = userLifecycleV1Topic();
    const outcome = await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<
        Array<{ email: string | null; is_deleted: boolean }>
      >`
        SELECT email, COALESCE(is_deleted, false) AS is_deleted
        FROM auth.users WHERE id = ${userId}::uuid FOR UPDATE
      `;
      const u = locked[0];
      if (!u) {
        return { kind: "notfound" as const };
      }
      if (u.is_deleted) {
        return { kind: "already_deleted" as const };
      }

      const eventId = randomUUID();
      const deletedAtIso = new Date().toISOString();
      const suffix = userId.replace(/-/g, "").slice(0, 8);
      const displayUsername = `deleted_user_${suffix}`;
      const deletedAt = new Date(deletedAtIso);
      const envelope = encodeUserAccountDeletedEnvelope({
        eventId,
        payload: {
          userId,
          deletionMode: "anonymize",
          gdprErasure: true,
          requestedBy: "self",
          deletedAtIso,
          reason: "user_requested",
        },
      });

      await tx.$executeRaw`DELETE FROM auth.oauth_providers WHERE user_id = ${userId}::uuid`;
      await tx.$executeRaw`DELETE FROM auth.mfa_settings WHERE user_id = ${userId}::uuid`;
      await tx.$executeRaw`DELETE FROM auth.verification_codes WHERE user_id = ${userId}::uuid`;
      await tx.$executeRaw`DELETE FROM auth.passkeys WHERE user_id = ${userId}::uuid`;
      await tx.$executeRaw`DELETE FROM auth.passkey_challenges WHERE user_id = ${userId}::uuid`;
      await tx.$executeRaw`
        UPDATE auth.users SET
          email = NULL,
          password_hash = NULL,
          phone = NULL,
          email_verified = false,
          phone_verified = false,
          mfa_enabled = false,
          settings = NULL,
          is_deleted = true,
          deleted_at = ${deletedAt},
          deletion_state = 'anonymized',
          display_username = ${displayUsername},
          updated_at = NOW()
        WHERE id = ${userId}::uuid AND COALESCE(is_deleted, false) = false
      `;
      await tx.$executeRaw`
        INSERT INTO auth.auth_outbox (id, aggregate_type, aggregate_id, event_type, topic, payload, created_at)
        VALUES (
          ${eventId}::uuid,
          'user',
          ${userId},
          ${USER_ACCOUNT_DELETED_V1},
          ${topic},
          ${envelope},
          NOW()
        )
      `;

      return { kind: "accepted" as const, eventId, emailWas: u.email };
    });

    if (outcome.kind === "notfound") {
      return sendAuthError(res, 404, "USER_NOT_FOUND", "User not found");
    }
    if (outcome.kind === "already_deleted") {
      return res
        .status(202)
        .json({ status: "already_deleted", user_id: userId });
    }

    if (outcome.emailWas) {
      await invalidateUserCache(outcome.emailWas);
    }

    try {
      if (payload.jti) {
        const now = Math.floor(Date.now() / 1000);
        const exp =
          typeof payload.exp === "number" ? payload.exp : now + 24 * 60 * 60;
        const ttl = Math.max(1, exp - now);
        await redis.set(`revoked:${payload.jti}`, "1", { EX: ttl });
      }
      await redis.set(`user:deleted:${userId}`, "1", { EX: 86400 * 7 });
    } catch (redisErr) {
      console.warn("auth-service: redis revoke after delete:", redisErr);
    }

    console.log(
      `[auth-service] Account anonymized for user ${userId} (outbox ${outcome.eventId})`,
    );
    return res
      .status(202)
      .json({ status: "accepted", user_id: userId, event_id: outcome.eventId });
  } catch (err: unknown) {
    console.error("auth-service: delete account error:", err);

    const jwtErr = classifyJwtError(err);
    if (jwtErr.code === "EXPIRED_TOKEN" || jwtErr.code === "INVALID_TOKEN") {
      return sendAuthError(res, 401, jwtErr.code, jwtErr.message);
    }

    return sendAuthError(res, 500, "INTERNAL_ERROR", "Internal server error");
  }
});

app.get("/me", (req: Request, res: Response) => {
  const auth = req.headers.authorization?.split(" ")[1];
  if (!auth) {
    return sendAuthError(
      res,
      401,
      "MISSING_TOKEN",
      "Authorization token is required",
    );
  }
  try {
    const payload = verifyJwt(auth);
    // Fetch additional user info
    prisma.$queryRaw<
      Array<{
        email_verified: boolean;
        phone_verified: boolean;
        mfa_enabled: boolean;
        is_deleted: boolean;
        display_username: string | null;
      }>
    >`
      SELECT email_verified, phone_verified, mfa_enabled,
             COALESCE(is_deleted, false) as is_deleted,
             display_username
      FROM auth.users
      WHERE id = ${payload.sub}::uuid
    `
      .then((r: any[]) => {
        res.json({
          ...payload,
          emailVerified: r[0]?.email_verified || false,
          phoneVerified: r[0]?.phone_verified || false,
          mfaEnabled: r[0]?.mfa_enabled || false,
          is_deleted: r[0]?.is_deleted || false,
          display_username: r[0]?.display_username ?? null,
        });
      })
      .catch(() => {
        res.json(payload);
      });
  } catch (err) {
    const jwtErr = classifyJwtError(err);
    return sendAuthError(res, 401, jwtErr.code, jwtErr.message);
  }
});

// Privacy Policy (required for OAuth consent screen)
app.get("/privacy", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Privacy Policy - Off-Campus-Housing-Tracker</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }
    h1 { color: #1a1a1a; border-bottom: 2px solid #e0e0e0; padding-bottom: 10px; }
    h2 { color: #2a2a2a; margin-top: 30px; }
    ul { margin: 10px 0; padding-left: 20px; }
    .last-updated { color: #666; font-size: 0.9em; margin-bottom: 30px; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Privacy Policy</h1>
  <p class="last-updated"><strong>Last updated:</strong> ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>

  <h2>1. Information We Collect</h2>
  <p>When you sign in with Google OAuth, we collect the following information:</p>
  <ul>
    <li><strong>Email address</strong> - Used to create and manage your account</li>
    <li><strong>Name</strong> - Your display name from your Google account</li>
    <li><strong>Profile picture</strong> - Your profile picture from your Google account (if available)</li>
    <li><strong>Google User ID</strong> - A unique identifier from Google to link your account</li>
  </ul>

  <h2>2. How We Use Your Information</h2>
  <p>We use the information we collect to:</p>
  <ul>
    <li>Create and manage your Off-Campus-Housing-Tracker account</li>
    <li>Provide you with access to our services</li>
    <li>Personalize your experience on the platform</li>
    <li>Communicate with you about your account and our services</li>
    <li>Ensure the security and integrity of our platform</li>
  </ul>

  <h2>3. Data Storage and Security</h2>
  <p>We take the security of your personal information seriously:</p>
  <ul>
    <li>Your data is stored securely in our databases</li>
    <li>We use industry-standard encryption to protect your information</li>
    <li>Access to your personal information is restricted to authorized personnel only</li>
    <li>We regularly review and update our security practices</li>
  </ul>

  <h2>4. Third-Party Services</h2>
  <p>We use Google OAuth for authentication. When you sign in with Google:</p>
  <ul>
    <li>Google handles the authentication process</li>
    <li>We only receive the information you authorize (email, name, profile picture)</li>
    <li>We do not have access to your Google password or other Google account information</li>
    <li>Your use of Google services is also governed by Google's Privacy Policy</li>
  </ul>

  <h2>5. Your Rights</h2>
  <p>You have the right to:</p>
  <ul>
    <li>Access the personal information we hold about you</li>
    <li>Request correction of inaccurate information</li>
    <li>Request deletion of your account and personal information</li>
    <li>Withdraw your consent for data processing at any time</li>
  </ul>

  <h2>6. Data Retention</h2>
  <p>We retain your personal information for as long as your account is active or as needed to provide you with our services. If you delete your account, we will delete your personal information in accordance with our data retention policies, except where we are required to retain it by law.</p>

  <h2>7. Changes to This Privacy Policy</h2>
  <p>We may update this Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last updated" date. You are advised to review this Privacy Policy periodically for any changes.</p>

  <h2>8. Contact Us</h2>
  <p>If you have any questions about this Privacy Policy or our data practices, please contact us:</p>
  <ul>
    <li><strong>Email:</strong> support@off-campus-housing-tracker.local</li>
    <li><strong>Platform:</strong> Off-Campus-Housing-Tracker</li>
  </ul>
</body>
</html>
  `);
});

// Terms of Service (optional but recommended for OAuth consent screen)
app.get("/terms", (_req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Terms of Service - Off-Campus-Housing-Tracker</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; }
    h1 { color: #1a1a1a; border-bottom: 2px solid #e0e0e0; padding-bottom: 10px; }
    h2 { color: #2a2a2a; margin-top: 30px; }
    ul { margin: 10px 0; padding-left: 20px; }
    .last-updated { color: #666; font-size: 0.9em; margin-bottom: 30px; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Terms of Service</h1>
  <p class="last-updated"><strong>Last updated:</strong> ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>

  <h2>1. Acceptance of Terms</h2>
  <p>By accessing and using Off-Campus-Housing-Tracker ("the Service"), you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to abide by the above, please do not use this service.</p>

  <h2>2. Use License</h2>
  <p>Permission is granted to temporarily use Off-Campus-Housing-Tracker for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not modify or copy the materials, use them for commercial purposes, or attempt to reverse engineer any software.</p>

  <h2>3. User Accounts</h2>
  <p>To access certain features, you must register for an account. You agree to provide accurate information, maintain account security, and accept responsibility for activities under your account.</p>

  <h2>4. User Content</h2>
  <p>You retain ownership of content you submit. By submitting content, you grant us a license to use it solely for operating the Service. You are responsible for your content and agree not to submit content that violates laws or infringes on others' rights.</p>

  <h2>5. Prohibited Uses</h2>
  <p>You may not use the Service to violate laws, transmit malicious code, impersonate others, engage in automated scraping, or interfere with the Service.</p>

  <h2>6. Intellectual Property</h2>
  <p>The Service and its content are owned by Off-Campus-Housing-Tracker and protected by intellectual property laws.</p>

  <h2>7. Disclaimer</h2>
  <p>The materials are provided on an 'as is' basis. Off-Campus-Housing-Tracker makes no warranties, expressed or implied.</p>

  <h2>8. Limitations</h2>
  <p>In no event shall Off-Campus-Housing-Tracker be liable for damages arising from use or inability to use the Service.</p>

  <h2>9. Termination</h2>
  <p>We may terminate your account immediately for breach of Terms. Upon termination, your right to use the Service ceases.</p>

  <h2>10. Changes to Terms</h2>
  <p>We reserve the right to modify these Terms at any time. Material changes will be notified at least 30 days in advance.</p>

  <h2>11. Contact Information</h2>
  <p>If you have questions about these Terms, please contact us at support@off-campus-housing-tracker.local</p>
</body>
</html>
  `);
});

// OAuth routes
app.use("/auth", setupOAuthRoutes(prisma));
app.use("/passkeys", passkeyRouter);

// Verification routes
app.use("/verify", setupVerificationRoutes(prisma));

// safety net
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error("auth service error:", msg);
  if (!res.headersSent) {
    return sendAuthError(res, 500, "INTERNAL_ERROR", "Internal server error");
  }
});

// Start HTTP server
const httpPort = process.env.AUTH_PORT || 4001;
app.listen(httpPort, () => {
  console.log(`auth HTTP server up on port ${httpPort}`);
  void import("./lib/auth-outbox-publisher.js").then(
    ({ startAuthOutboxPublisher }) => {
      startAuthOutboxPublisher(prisma);
    },
  );
});

// Start gRPC server
if (process.env.ENABLE_GRPC !== "false") {
  import("./grpc-server.js")
    .then(({ startGrpcServer }) => {
      const grpcPort = parseInt(process.env.GRPC_PORT || "50051", 10);
      startGrpcServer(grpcPort);
    })
    .catch((e) => {
      console.error("Failed to start gRPC server:", e);
    });
}
