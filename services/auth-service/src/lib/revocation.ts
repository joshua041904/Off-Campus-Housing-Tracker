/**
 * Token revocation (JTI) and soft-delete markers on Redis.
 * Under Vitest, uses an in-process map so HTTP + gRPC tests do not depend on
 * a live Redis or the client offline command queue.
 */

const memJtiUntil = new Map<string, number>();

function useVitestMemory(): boolean {
  return process.env.VITEST === "true";
}

type RedisSet = {
  set: (key: string, value: string, opts?: { EX: number }) => Promise<unknown>;
};

type RedisGet = {
  get: (key: string) => Promise<string | null>;
};

export async function setJtiRevoked(
  redis: RedisSet | null | undefined,
  jti: string,
  ttlSec: number,
): Promise<void> {
  const ttl = Math.max(1, ttlSec);
  if (useVitestMemory()) {
    memJtiUntil.set(jti, Date.now() + ttl * 1000);
    return;
  }
  if (!redis) return;
  const legacy = `revoked:${jti}`;
  const canonical = `och:auth:jti:revoked:${jti}`;
  await Promise.all([
    redis.set(canonical, "1", { EX: ttl }),
    redis.set(legacy, "1", { EX: ttl }),
  ]);
}

export async function isJtiRevoked(
  redis: RedisGet | null | undefined,
  jti: string | undefined,
): Promise<boolean> {
  if (!jti) return false;
  if (useVitestMemory()) {
    const until = memJtiUntil.get(jti);
    if (until == null) return false;
    if (Date.now() > until) {
      memJtiUntil.delete(jti);
      return false;
    }
    return true;
  }
  if (!redis) return false;
  try {
    const [a, b] = await Promise.all([
      redis.get(`och:auth:jti:revoked:${jti}`),
      redis.get(`revoked:${jti}`),
    ]);
    return Boolean(a || b);
  } catch {
    return false;
  }
}

const memUserDeletedUntil = new Map<string, number>();

export async function setUserDeletedMarker(
  redis: RedisSet | null | undefined,
  userId: string,
  ttlSec: number,
): Promise<void> {
  const ttl = Math.max(1, ttlSec);
  if (useVitestMemory()) {
    memUserDeletedUntil.set(userId, Date.now() + ttl * 1000);
    return;
  }
  if (!redis) return;
  await redis.set(`user:deleted:${userId}`, "1", { EX: ttl });
}

/** Vitest-only: seed revocation without going through HTTP logout. */
export function __testSeedRevokedJti(jti: string, ttlSec = 120): void {
  if (!useVitestMemory()) {
    throw new Error("__testSeedRevokedJti is only for VITEST=true");
  }
  memJtiUntil.set(jti, Date.now() + Math.max(1, ttlSec) * 1000);
}

/** Vitest-only: reset in-memory revocation between tests. */
export function __testClearRevocationMemory(): void {
  if (!useVitestMemory()) return;
  memJtiUntil.clear();
  memUserDeletedUntil.clear();
}
