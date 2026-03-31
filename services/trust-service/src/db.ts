import pg from "pg";

const { Pool } = pg;

/** Trust DB is port 5446 in docker-compose / docs. Do not use generic DB_PORT (other services differ). */
const trustPort = process.env.TRUST_DB_PORT || "5446";

const conn =
  process.env.POSTGRES_URL_TRUST ||
  `postgresql://${process.env.DB_USER || "postgres"}:${process.env.DB_PASSWORD || "postgres"}@${process.env.DB_HOST || "127.0.0.1"}:${trustPort}/${process.env.DB_NAME || "trust"}`;

/** Default raised for gateway + H2 multiplexed load; tune via TRUST_DB_POOL_MAX. */
const poolMaxRaw = Number(process.env.TRUST_DB_POOL_MAX ?? "50");
const poolMax = Number.isFinite(poolMaxRaw) && poolMaxRaw > 0 ? Math.floor(poolMaxRaw) : 50;
const inflightLimitRaw = Number(process.env.MAX_DB_CONCURRENCY ?? `${poolMax}`);
const inflightLimit = Number.isFinite(inflightLimitRaw) && inflightLimitRaw > 0 ? Math.floor(inflightLimitRaw) : poolMax;

export const pool = new Pool({
  connectionString: conn,
  max: poolMax,
  connectionTimeoutMillis: 10_000,
});

function attachConcurrencyGuard(target: InstanceType<typeof Pool>, maxInflight: number): void {
  const originalQuery = target.query.bind(target) as (...args: any[]) => Promise<any>;
  let inflight = 0;
  const waiters: Array<() => void> = [];
  const acquire = async (): Promise<void> => {
    if (inflight < maxInflight) {
      inflight += 1;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
    inflight += 1;
  };
  const release = (): void => {
    inflight = Math.max(0, inflight - 1);
    const next = waiters.shift();
    if (next) next();
  };
  (target as any).query = async (...args: any[]): Promise<any> => {
    await acquire();
    try {
      return await originalQuery(...args);
    } finally {
      release();
    }
  };
  const metricsMs = Number(process.env.DB_CONCURRENCY_METRICS_MS || "0");
  if (metricsMs > 0) {
    const h = setInterval(() => {
      console.info(`[trust-service] db_concurrency inflight=${inflight} waiters=${waiters.length} max=${maxInflight}`);
    }, metricsMs);
    h.unref();
  }
}

attachConcurrencyGuard(pool, inflightLimit);

console.info(
  `[trust-service] DB pool max=${poolMax} inflight_limit=${inflightLimit} host=${process.env.DB_HOST || "127.0.0.1"} port=${trustPort} db=${process.env.DB_NAME || "trust"}`,
);

const poolMetricsMs = Number(process.env.TRUST_DB_POOL_METRICS_MS || "0");
if (poolMetricsMs > 0) {
  const tick = (): void => {
    console.info(
      `[trust-service] db_pool total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`,
    );
  };
  const handle = setInterval(tick, poolMetricsMs);
  handle.unref();
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Best-effort warm-up so the first real query is less likely to hit a cold DNS/connect failure.
 * Runs in the background from server bootstrap; does not block HTTP/gRPC bind.
 */
export async function warmupTrustDb(): Promise<void> {
  const w = process.env.TRUST_DB_WARMUP;
  if (w === "0" || w === "false") return;

  const retries = envInt("TRUST_DB_WARMUP_RETRIES", 12);
  const baseMs = envInt("TRUST_DB_WARMUP_DELAY_MS", 1000);
  let last: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query("SELECT 1");
      console.info(`[trust-service] DB warmup ok (attempt ${i + 1}/${retries})`);
      return;
    } catch (e) {
      last = e;
      const exp = Math.min(5, i);
      const wait = Math.min(30_000, baseMs * 2 ** exp);
      console.warn(
        `[trust-service] DB warmup attempt ${i + 1}/${retries} failed; retry in ${wait}ms`,
        e,
      );
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  console.error("[trust-service] DB warmup exhausted retries", last);
}
