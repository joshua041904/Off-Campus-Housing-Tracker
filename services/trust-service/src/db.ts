import pg from "pg";

const { Pool } = pg;

/** Trust DB is port 5446 in docker-compose / docs. Do not use generic DB_PORT (other services differ). */
const trustPort = process.env.TRUST_DB_PORT || "5446";

const conn =
  process.env.POSTGRES_URL_TRUST ||
  `postgresql://${process.env.DB_USER || "postgres"}:${process.env.DB_PASSWORD || "postgres"}@${process.env.DB_HOST || "127.0.0.1"}:${trustPort}/${process.env.DB_NAME || "trust"}`;

/** Default 20: k6 matrix / gateway fan-out can exceed 10 concurrent DB clients; tune via TRUST_DB_POOL_MAX. */
const poolMaxRaw = Number(process.env.TRUST_DB_POOL_MAX ?? "20");
const poolMax = Number.isFinite(poolMaxRaw) && poolMaxRaw > 0 ? Math.floor(poolMaxRaw) : 20;

export const pool = new Pool({
  connectionString: conn,
  max: poolMax,
  connectionTimeoutMillis: 10_000,
});

console.info(
  `[trust-service] DB pool max=${poolMax} (override with TRUST_DB_POOL_MAX) host=${process.env.DB_HOST || "127.0.0.1"} port=${trustPort} db=${process.env.DB_NAME || "trust"}`,
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
