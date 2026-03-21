import { getRedis } from "./redis.js";

/** Atomic SET key NX with TTL (ms). Returns true if lock acquired. */
export async function acquireLockWithToken(key: string, token: string, ttlMs: number): Promise<boolean> {
  const r = await getRedis().set(key, token, "PX", ttlMs, "NX");
  return r === "OK";
}

/** Lua: release lock only if value matches token (safe unlock). */
const LUA_RELEASE_LOCK = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export async function releaseLockWithToken(key: string, token: string): Promise<boolean> {
  const n = (await getRedis().eval(LUA_RELEASE_LOCK, 1, key, token)) as number;
  return n === 1;
}

/** Token bucket style: increment under cap using a single Lua script (thundering herd / burst control). */
const LUA_INCR_CAP = `
local v = redis.call("incrby", KEYS[1], tonumber(ARGV[1]))
if v > tonumber(ARGV[2]) then
  redis.call("decrby", KEYS[1], tonumber(ARGV[1]))
  return -1
end
redis.call("pexpire", KEYS[1], tonumber(ARGV[3]))
return v
`;

export async function incrementUnderCap(key: string, delta: number, cap: number, ttlMs: number): Promise<number> {
  const v = (await getRedis().eval(LUA_INCR_CAP, 1, key, String(delta), String(cap), String(ttlMs))) as number;
  return v;
}

/**
 * Messaging send rate limit: per-minute + per-day counters in one atomic Lua script.
 * Increments both; if either cap is exceeded, rolls back both increments for this request (fair reject).
 * Matches former MULTI/EXEC behavior for limits but avoids multiple round-trips and keeps atomicity explicit.
 */
const LUA_MESSAGING_SEND_RATE = `
local minKey = KEYS[1]
local dayKey = KEYS[2]
local maxMin = tonumber(ARGV[1])
local maxDay = tonumber(ARGV[2])
local winSec = tonumber(ARGV[3])
local daySec = tonumber(ARGV[4])

local minCount = redis.call('incr', minKey)
if minCount == 1 then redis.call('expire', minKey, winSec) end
local dayCount = redis.call('incr', dayKey)
if dayCount == 1 then redis.call('expire', dayKey, daySec) end

if minCount > maxMin then
  redis.call('decr', minKey)
  redis.call('decr', dayKey)
  return -1
end
if dayCount > maxDay then
  redis.call('decr', minKey)
  redis.call('decr', dayKey)
  return -2
end
return 0
`;

export type MessagingRateLimitOptions = {
  keyPrefix?: string;
  maxPerMinute?: number;
  maxPerDay?: number;
  windowSec?: number;
  daySec?: number;
};

/** @throws Error RATE_LIMIT_EXCEEDED_PER_MINUTE | RATE_LIMIT_EXCEEDED_PER_DAY | RATE_LIMIT_UNAVAILABLE */
export async function checkMessagingSendRateLimit(userId: string, opts: MessagingRateLimitOptions = {}): Promise<void> {
  const prefix = opts.keyPrefix ?? "rate:msg:";
  const maxPerMinute = opts.maxPerMinute ?? 30;
  const maxPerDay = opts.maxPerDay ?? 500;
  const windowSec = opts.windowSec ?? 60;
  const daySec = opts.daySec ?? 86400;
  const keyMin = `${prefix}${userId}`;
  const keyDay = `${prefix}day:${userId}`;
  const redis = getRedis();
  let raw: unknown;
  const evalRate = () =>
    redis.eval(
      LUA_MESSAGING_SEND_RATE,
      2,
      keyMin,
      keyDay,
      String(maxPerMinute),
      String(maxPerDay),
      String(windowSec),
      String(daySec),
    );
  try {
    raw = await evalRate();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("Stream") || msg.includes("writeable")) {
      try {
        await redis.connect();
        raw = await evalRate();
      } catch (e2: unknown) {
        console.error("[redis-lua] messaging rate limit Redis error (retry):", e2);
        throw new Error("RATE_LIMIT_UNAVAILABLE");
      }
    } else {
      console.error("[redis-lua] messaging rate limit Redis error:", e);
      throw new Error("RATE_LIMIT_UNAVAILABLE");
    }
  }
  const code = typeof raw === "number" ? raw : Number(raw);
  if (code === -1) throw new Error("RATE_LIMIT_EXCEEDED_PER_MINUTE");
  if (code === -2) throw new Error("RATE_LIMIT_EXCEEDED_PER_DAY");
}
