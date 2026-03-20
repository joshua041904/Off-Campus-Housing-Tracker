import pg from "pg";

const { Pool } = pg;

// Create a connection pool to the PostgreSQL database using environment variables
export const pool = new Pool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 5442),
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "postgres",
  database: process.env.DB_NAME || "listings",
});
