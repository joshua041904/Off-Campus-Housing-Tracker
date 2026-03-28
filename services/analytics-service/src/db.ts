import pg from "pg";

const { Pool } = pg;

const analyticsPort = process.env.ANALYTICS_DB_PORT || "5447";

const conn =
  process.env.POSTGRES_URL_ANALYTICS ||
  `postgresql://${process.env.DB_USER || "postgres"}:${process.env.DB_PASSWORD || "postgres"}@${process.env.DB_HOST || "127.0.0.1"}:${analyticsPort}/${process.env.DB_NAME || "analytics"}`;
const poolMaxRaw = Number(process.env.ANALYTICS_DB_POOL_MAX ?? "50");
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
}

attachConcurrencyGuard(pool, inflightLimit);
