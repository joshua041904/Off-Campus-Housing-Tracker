import pg from "pg";

const { Pool } = pg;

/** Optional read-only pool to booking DB for reputation aggregates (completed stays only). */
const url = process.env.POSTGRES_URL_BOOKINGS?.trim();

export const bookingReadPool: pg.Pool | null = url
  ? new Pool({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 5_000,
    })
  : null;
