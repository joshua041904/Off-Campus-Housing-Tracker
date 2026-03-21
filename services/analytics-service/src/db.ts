import pg from "pg";

const { Pool } = pg;

const analyticsPort = process.env.ANALYTICS_DB_PORT || "5447";

const conn =
  process.env.POSTGRES_URL_ANALYTICS ||
  `postgresql://${process.env.DB_USER || "postgres"}:${process.env.DB_PASSWORD || "postgres"}@${process.env.DB_HOST || "127.0.0.1"}:${analyticsPort}/${process.env.DB_NAME || "analytics"}`;

export const pool = new Pool({
  connectionString: conn,
  max: 10,
  connectionTimeoutMillis: 10_000,
});
