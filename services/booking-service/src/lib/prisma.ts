/**
 * Single PrismaClient for booking-service (HTTP + gRPC) with explicit pool sizing for H2-multiplexed load.
 * Override: BOOKING_DB_CONNECTION_LIMIT (default 50). Postgres max_connections raised in docker-compose.
 */
import { PrismaClient } from "../../prisma/generated/client/index.js";

const connectionString = process.env.POSTGRES_URL_BOOKINGS || "";
const connectionLimitRaw = Number(process.env.BOOKING_DB_CONNECTION_LIMIT ?? "50");
const connectionLimit =
  Number.isFinite(connectionLimitRaw) && connectionLimitRaw > 0 ? Math.floor(connectionLimitRaw) : 50;
const poolTimeout = 30;

let prismaUrl = connectionString;
if (prismaUrl && !prismaUrl.includes("connection_limit")) {
  const separator = prismaUrl.includes("?") ? "&" : "?";
  prismaUrl = `${prismaUrl}${separator}connection_limit=${connectionLimit}&pool_timeout=${poolTimeout}`;
}

const prismaLog =
  process.env.NODE_ENV === "development" ? (["query", "error", "warn"] as const) : (["error"] as const);

export const prisma = prismaUrl
  ? new PrismaClient({
      datasources: { db: { url: prismaUrl } },
      log: [...prismaLog],
    })
  : new PrismaClient({ log: [...prismaLog] });
