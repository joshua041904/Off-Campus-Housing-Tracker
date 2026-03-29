import type { createClient } from "redis";

type GatewayRedis = ReturnType<typeof createClient>;

/** Capacity multiplier for E2E traffic shaper when transport-watchdog sets Redis throttle key. */
let shaperCapacityFactor = 1;

export function getTrafficShaperCapacityFactor(): number {
  return shaperCapacityFactor;
}

/**
 * Poll Redis for `och:gw:watchdog_throttle` (set by transport-watchdog sidecar). On failure → factor 1 (fail-open).
 */
export function startWatchdogThrottlePoller(redis: GatewayRedis, key: string, intervalMs: number): void {
  const tick = async (): Promise<void> => {
    try {
      if (!redis.isOpen) return;
      const v = await redis.get(key);
      shaperCapacityFactor = v === "1" ? 0.5 : 1;
    } catch {
      shaperCapacityFactor = 1;
    }
  };
  void tick();
  const id = setInterval(() => void tick(), intervalMs);
  id.unref?.();
}
