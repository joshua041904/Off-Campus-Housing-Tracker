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
