import pg from "pg";

const { Pool } = pg;

/** Optional read-only pool to booking DB for “your past searches” insights (dev convenience; prefer Kafka projection long-term). */
const url = process.env.POSTGRES_URL_BOOKINGS?.trim();

export const bookingReadPool: pg.Pool | null = url
  ? new Pool({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 5_000,
    })
  : null;

if (bookingReadPool) {
  const limitRaw = Number(process.env.ANALYTICS_BOOKING_READ_MAX_DB_CONCURRENCY ?? "3");
  const maxInflight = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 3;
  const originalQuery = bookingReadPool.query.bind(bookingReadPool) as (...args: any[]) => Promise<any>;
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
  (bookingReadPool as any).query = async (...args: any[]): Promise<any> => {
    await acquire();
    try {
      return await originalQuery(...args);
    } finally {
      release();
    }
  };
}
