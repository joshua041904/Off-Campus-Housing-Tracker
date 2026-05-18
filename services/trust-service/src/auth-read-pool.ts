import pg from "pg";

const { Pool } = pg;

/** Optional read-only pool to auth DB for public username/display handle → user id resolution. */
const url = process.env.POSTGRES_URL_AUTH?.trim();

export const authReadPool: pg.Pool | null = url
  ? new Pool({
      connectionString: url,
      max: 4,
      connectionTimeoutMillis: 5_000,
    })
  : null;
