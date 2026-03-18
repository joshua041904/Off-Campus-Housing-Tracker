/**
 * Shared PrismaClient instance for auth-service
 * 
 * CRITICAL: Use a single PrismaClient instance to avoid connection pool exhaustion
 * Each PrismaClient instance creates its own connection pool (~10 connections by default)
 * Multiple instances = multiple pools = connection exhaustion under load
 */

import { PrismaClient } from "../../prisma/generated/client";

// Connection pool configuration for production load
// Prisma defaults to ~10 connections per instance
// With connection_limit=20, we get 20 connections per instance
// Since we use a SINGLE shared instance, this gives us 20 total connections
const connectionString = process.env.POSTGRES_URL_AUTH || '';
// Increased connection pool for high load (k6 tests can generate many concurrent requests)
// With HTTP/2/3 multiplexing, we can handle more concurrent requests efficiently
// But each request still needs a DB connection, so we need a larger pool
// Expanded connection pool for high concurrent load
// k6 tests can generate: 20 VUs × 2 req/s = 40 concurrent requests
// Each request needs a DB connection, and requests take 2-3s each
// With connection_limit=100, we can handle burst load better
// Database max_connections=500 (configured in docker-compose.yml), so 100 is safe
const connectionLimit = 100; // High concurrency: authentication and user operations
const poolTimeout = 30; // Increased timeout to handle connection pool contention under load

// Build connection string with pool parameters
let prismaUrl = connectionString;
if (!prismaUrl.includes('connection_limit')) {
  const separator = prismaUrl.includes('?') ? '&' : '?';
  prismaUrl = `${prismaUrl}${separator}connection_limit=${connectionLimit}&pool_timeout=${poolTimeout}`;
}

// Create SINGLE shared PrismaClient instance
// This instance is reused across server.ts, grpc-server.ts, and passkey.ts
export const prisma = new PrismaClient({
  datasources: {
    db: {
      url: prismaUrl,
    },
  },
  log: process.env.NODE_ENV === 'development' 
    ? ['query', 'error', 'warn'] 
    : ['error'],
});

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect();
});

