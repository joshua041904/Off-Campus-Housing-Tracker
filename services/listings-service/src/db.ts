import pg from "pg";

const { Pool } = pg;

/** Listings DB is port 5442 in docker-compose / docs. Do not use generic DB_PORT (other services differ). */
const listingsPort = process.env.LISTINGS_DB_PORT || "5442";

const conn =
  process.env.POSTGRES_URL_LISTINGS ||
  (process.env.DB_HOST
    ? `postgresql://${process.env.DB_USER || "postgres"}:${process.env.DB_PASSWORD || "postgres"}@${process.env.DB_HOST}:${listingsPort}/${process.env.DB_NAME || "listings"}`
    : `postgresql://postgres:postgres@127.0.0.1:${listingsPort}/listings`);

export const pool = new Pool({
  connectionString: conn,
  max: 10,
  connectionTimeoutMillis: 10_000,
});
