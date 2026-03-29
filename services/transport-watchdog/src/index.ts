/**
 * Sidecar: probes local api-gateway readiness and toggles a Redis key consumed by the gateway
 * (watchdog-throttle-poll → halves E2E traffic shaper headroom when unhealthy).
 */
import { createClient } from "redis";

const REDIS_URL = process.env.REDIS_URL || "redis://redis:6379";
const KEY = process.env.TRANSPORT_WATCHDOG_REDIS_KEY || "och:gw:watchdog_throttle";
const GATEWAY_READY_URL =
  process.env.TRANSPORT_WATCHDOG_GATEWAY_URL || "http://127.0.0.1:4020/readyz";
const INTERVAL_MS = Math.max(5000, Number.parseInt(process.env.TRANSPORT_WATCHDOG_INTERVAL_MS ?? "15000", 10) || 15000);
const KEY_TTL_SEC = Math.max(30, Number.parseInt(process.env.TRANSPORT_WATCHDOG_KEY_TTL_SEC ?? "120", 10) || 120);

function abortAfter(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

async function tick(redis: ReturnType<typeof createClient>): Promise<void> {
  let bad = false;
  try {
    const r = await fetch(GATEWAY_READY_URL, { signal: abortAfter(8000) });
    bad = !r.ok;
  } catch {
    bad = true;
  }
  try {
    if (bad) {
      await redis.set(KEY, "1", { EX: KEY_TTL_SEC });
      console.log(`[transport-watchdog] gateway not ready → SET ${KEY} (EX ${KEY_TTL_SEC})`);
    } else {
      await redis.del(KEY);
    }
  } catch (e) {
    console.error("[transport-watchdog] redis write failed:", e);
  }
}

async function main(): Promise<void> {
  const redis = createClient({ url: REDIS_URL, socket: { connectTimeout: 10_000 } });
  redis.on("error", (e) => console.error("[transport-watchdog] redis:", e));
  await redis.connect();
  console.log(`[transport-watchdog] connected redis; probing ${GATEWAY_READY_URL} every ${INTERVAL_MS}ms`);

  await tick(redis);
  setInterval(() => void tick(redis), INTERVAL_MS);
}

void main().catch((e) => {
  console.error("[transport-watchdog] fatal:", e);
  process.exit(1);
});
