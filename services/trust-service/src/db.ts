import pg from "pg";

const { Pool } = pg;

/** Trust DB is port 5446 in docker-compose / docs. Do not use generic DB_PORT (other services differ). */
const trustPort = process.env.TRUST_DB_PORT || "5446";

const conn =
  process.env.POSTGRES_URL_TRUST ||
  `postgresql://${process.env.DB_USER || "postgres"}:${process.env.DB_PASSWORD || "postgres"}@${process.env.DB_HOST || "127.0.0.1"}:${trustPort}/${process.env.DB_NAME || "trust"}`;

export const pool = new Pool({
  connectionString: conn,
  max: 10,
  connectionTimeoutMillis: 10_000,
});
