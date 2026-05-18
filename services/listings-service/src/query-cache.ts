import { createHash } from "node:crypto";
import { createClient, type RedisClientType } from "redis";

type CacheEntry = {
  value: string;
  expiresAt: number;
};

const localCache = new Map<string, CacheEntry>();
const ttlSec = Math.max(5, Number(process.env.LISTINGS_CACHE_TTL_SEC || "30"));
const redisUrl = process.env.REDIS_URL || "redis://redis:6379";
const redisEnabled =
  process.env.LISTINGS_REDIS_CACHE !== "0" &&
  process.env.VITEST !== "true" &&
  process.env.OCH_DISABLE_EXTERNALS !== "1";
let redis: RedisClientType | null = null;
let redisConnectAttempted = false;

function nowMs(): number {
  return Date.now();
}

async function getRedis(): Promise<RedisClientType | null> {
  if (!redisEnabled) return null;
  if (redis?.isOpen) return redis;
  if (redisConnectAttempted) return null;
  redisConnectAttempted = true;
  try {
    redis = createClient({ url: redisUrl, socket: { connectTimeout: 500 } });
    redis.on("error", () => {});
    await Promise.race([
      redis.connect(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("redis connect timeout")), 150)),
    ]);
    return redis;
  } catch {
    return null;
  }
}

export function buildListingsCacheKey(input: Record<string, unknown>): string {
  const serialized = JSON.stringify(
    Object.keys(input)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = input[key];
        return acc;
      }, {}),
  );
  return `listings:search:${createHash("sha256").update(serialized).digest("hex").slice(0, 24)}`;
}

export async function getCachedSearch(key: string): Promise<string | null> {
  const r = await getRedis();
  if (r?.isOpen) {
    const hit = await r.get(key);
    if (hit) return hit;
  }
  const local = localCache.get(key);
  if (!local || local.expiresAt <= nowMs()) {
    localCache.delete(key);
    return null;
  }
  return local.value;
}

export async function setCachedSearch(key: string, value: string): Promise<void> {
  const r = await getRedis();
  if (r?.isOpen) {
    await r.set(key, value, { EX: ttlSec });
  }
  localCache.set(key, { value, expiresAt: nowMs() + ttlSec * 1000 });
}

export async function getListingBookingCount(listingId: string): Promise<number> {
  const key = `listing:${listingId}:booking_count`;
  const r = await getRedis();
  if (r?.isOpen) {
    const value = await r.get(key);
    const n = Number(value || "0");
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  }
  const local = localCache.get(key);
  if (!local || local.expiresAt <= nowMs()) return 0;
  const n = Number(local.value || "0");
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}
