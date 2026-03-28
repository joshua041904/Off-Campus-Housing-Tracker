import pg from "pg";

const url = process.env.POSTGRES_URL_NOTIFICATION || process.env.DATABASE_URL_NOTIFICATION;
if (!url) {
  console.warn("[notification] POSTGRES_URL_NOTIFICATION not set — DB features disabled");
}

export const pool = url
  ? new pg.Pool({
      connectionString: url,
      max: Number(process.env.NOTIFICATION_DB_POOL_MAX ?? "50") || 50,
      min: Number(process.env.NOTIFICATION_DB_POOL_MIN ?? "5") || 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 8000,
    })
  : (null as unknown as pg.Pool);
