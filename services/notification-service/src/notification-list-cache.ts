import { createHash } from "node:crypto";
import { getRedis } from "@common/utils/redis";

const CACHE_TTL_SEC = Math.min(
  15,
  Math.max(2, Number(process.env.NOTIFICATION_LIST_CACHE_TTL_SEC || 3)),
);
const INDEX_PREFIX = "cache-index:user:";

export type NotificationListCacheQuery = {
  userId: string;
  limit: number;
  audience: string | null;
  categoryBooking: boolean;
  eventTypes: string[] | null;
  scope?: string;
};

function listCacheKey(q: NotificationListCacheQuery): string {
  const types = q.eventTypes?.length ? q.eventTypes.join(",") : "";
  const aud = q.audience || "any";
  const cat = q.categoryBooking ? "booking" : "all";
  const scope = q.scope || "all";
  return `notifications:user:${q.userId}:scope:${scope}:aud:${aud}:cat:${cat}:lim:${q.limit}:types:${types}:v3`;
}

function indexKey(userId: string): string {
  return `${INDEX_PREFIX}${userId}`;
}

export async function getCachedNotificationList(
  q: NotificationListCacheQuery,
): Promise<{ items: unknown[] } | null> {
  try {
    const redis = getRedis();
    const raw = await redis.get(listCacheKey(q));
    if (!raw) return null;
    return JSON.parse(raw) as { items: unknown[] };
  } catch {
    return null;
  }
}

export async function setCachedNotificationList(
  q: NotificationListCacheQuery,
  items: unknown[],
): Promise<void> {
  try {
    const redis = getRedis();
    const key = listCacheKey(q);
    await redis.set(key, JSON.stringify({ items }), "EX", CACHE_TTL_SEC);
    await redis.sadd(indexKey(q.userId), key);
    await redis.expire(indexKey(q.userId), CACHE_TTL_SEC + 5);
  } catch {
    /* cache optional */
  }
}

/** Delete all list keys indexed for this user (mark-read, new notification). */
export async function invalidateNotificationListCacheForUser(userId: string): Promise<number> {
  try {
    const redis = getRedis();
    const uid = String(userId || "").trim().toLowerCase();
    const idx = indexKey(uid);
    const keys = new Set<string>(await redis.smembers(idx));
    let cursor = "0";
    do {
      const [next, found] = await redis.scan(
        cursor,
        "MATCH",
        `notifications:user:${uid}:*`,
        "COUNT",
        100,
      );
      cursor = next;
      for (const k of found) keys.add(k);
    } while (cursor !== "0");
    if (!keys.size) return 0;
    const pipe = redis.pipeline();
    for (const k of Array.from(keys)) pipe.del(k);
    pipe.del(idx);
    await pipe.exec();
    return keys.size;
  } catch {
    return 0;
  }
}

export function notificationListCacheHeaders(hit: boolean, source: "redis" | "db"): Record<string, string> {
  return {
    "X-OCH-Cache": hit ? "hit" : "miss",
    "X-OCH-Data-Source": source,
  };
}

export function hashEventTypes(types: string[] | null): string {
  if (!types?.length) return "";
  return createHash("sha1").update(types.join(",")).digest("hex").slice(0, 12);
}
