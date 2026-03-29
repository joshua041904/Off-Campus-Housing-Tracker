import type { NextFunction, Request, Response } from "express";
import type { createClient } from "redis";
import { gatewayPathOnly, skipsGatewayTrafficControls } from "./gateway-traffic-skip.js";

type GatewayRedis = ReturnType<typeof createClient>;

/**
 * KEYS[1] = Redis key holding current weighted sum (integer string).
 * ARGV[1] = weight to add (positive int).
 * ARGV[2] = cluster cap (positive int).
 * Returns: Redis integer 1 if acquired, 0 if over cap.
 */
export const LUA_CLUSTER_WEIGHT_TRY = `local w = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
if w == nil or cap == nil or w < 1 or cap < 1 then return redis.error_reply('badarg') end
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur + w > cap then
  return 0
end
redis.call('INCRBY', KEYS[1], w)
redis.call('EXPIRE', KEYS[1], 180)
return 1`;

/**
 * KEYS[1] = same key as try.
 * ARGV[1] = weight to release (positive int).
 * Returns: amount decremented (may be less than requested if counter was low).
 */
export const LUA_CLUSTER_WEIGHT_RELEASE = `local w = tonumber(ARGV[1])
if w == nil or w < 1 then return 0 end
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local dec = math.min(w, cur)
if dec > 0 then
  redis.call('INCRBY', KEYS[1], -dec)
end
return dec`;

/** CPU-weight table (normalized); messaging is hottest per cluster observability. */
const SEGMENT_WEIGHT: Record<string, number> = {
  listings: 1,
  trust: 1,
  media: 1,
  notification: 1,
  booking: 2,
  analytics: 2,
  auth: 2,
  messaging: 5,
  forum: 5,
  messages: 5,
};

export function gatewayRouteWeight(req: Request): number {
  const p = gatewayPathOnly(req);
  const m = p.match(/^\/(?:api\/)?([^/?]+)/);
  const seg = (m?.[1] || "").toLowerCase();
  return SEGMENT_WEIGHT[seg] ?? 1;
}

export type ClusterWeightBudgetOptions = {
  redis: GatewayRedis;
  /** Redis key for weighted inflight sum (e.g. och:cluster:weight:sum). */
  key: string;
  /** Max weighted units cluster-wide (e.g. 500). */
  cap: number;
};

/**
 * Atomic cluster-wide weighted budget via Redis **EVAL** (Lua). Fail-open if Redis is down or not ready.
 * Enable with **GATEWAY_CLUSTER_WEIGHT_ENABLED=1**.
 */
export function createClusterWeightBudgetMiddleware(opts: ClusterWeightBudgetOptions): (req: Request, res: Response, next: NextFunction) => void {
  const { redis, key, cap } = opts;

  return function clusterWeightBudget(req: Request, res: Response, next: NextFunction): void {
    if (skipsGatewayTrafficControls(req)) {
      next();
      return;
    }

    const weight = gatewayRouteWeight(req);
    if (weight < 1) {
      next();
      return;
    }

    if (!redis.isOpen) {
      next();
      return;
    }

    void (async () => {
      try {
        const ok = await redis.eval(LUA_CLUSTER_WEIGHT_TRY, {
          keys: [key],
          arguments: [String(weight), String(cap)],
        });
        if (Number(ok) !== 1) {
          if (!res.headersSent) {
            res.status(503).setHeader("Retry-After", "1").json({
              error: "cluster_weight_exceeded",
              message: "Cluster-wide weighted concurrency budget full",
            });
          }
          return;
        }

        let released = false;
        const release = async (): Promise<void> => {
          if (released) return;
          released = true;
          try {
            if (redis.isOpen) {
              await redis.eval(LUA_CLUSTER_WEIGHT_RELEASE, {
                keys: [key],
                arguments: [String(weight)],
              });
            }
          } catch {
            /* best-effort */
          }
        };
        res.once("finish", () => void release());
        res.once("close", () => void release());
        next();
      } catch (e) {
        console.error("[gateway] cluster weight budget redis error:", e);
        next();
      }
    })();
  };
}
