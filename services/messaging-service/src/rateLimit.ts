import { checkMessagingSendRateLimit } from "@common/utils";
import { getRedis } from "@common/utils/redis";

const PREFIX = "rate:msg:";
const WINDOW_SEC = 60;
const MAX_PER_MINUTE = 30;
const MAX_PER_DAY = 500;
const DAY_SEC = 86400;

/**
 * Check and increment message rate limit for user (Redis Lua: atomic minute + day windows).
 * Rules: 30 messages/minute, 500/day. If exceeded, throws RATE_LIMIT_* (caller maps to gRPC RESOURCE_EXHAUSTED).
 * Redis down: fail safe by blocking (RATE_LIMIT_UNAVAILABLE).
 */
export async function checkAndIncrement(userId: string): Promise<void> {
  const redis = getRedis();
  try {
    const status = (redis as { status?: string }).status;
    if (status === "wait") {
      await redis.connect();
    } else if (status === "connecting") {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("Redis connect timeout")), 5000);
        const cleanup = () => {
          clearTimeout(t);
          (redis as { off?: (ev: string, fn: () => void) => void }).off?.("ready", onReady);
          (redis as { off?: (ev: string, fn: (err: unknown) => void) => void }).off?.("error", onError);
        };
        const onReady = () => {
          cleanup();
          resolve();
        };
        const onError = (err: unknown) => {
          cleanup();
          reject(err);
        };
        (redis as { once?: (ev: string, fn: (...args: unknown[]) => void) => void }).once?.("ready", onReady);
        (redis as { once?: (ev: string, fn: (...args: unknown[]) => void) => void }).once?.("error", onError);
      });
    }
  } catch (err) {
    console.error("[rateLimit] Redis connect:", err);
    throw new Error("RATE_LIMIT_UNAVAILABLE");
  }

  await checkMessagingSendRateLimit(userId, {
    keyPrefix: PREFIX,
    maxPerMinute: MAX_PER_MINUTE,
    maxPerDay: MAX_PER_DAY,
    windowSec: WINDOW_SEC,
    daySec: DAY_SEC,
  });
}
