/**
 * In-process Redis for api-gateway when external brokers must not be contacted
 * (local Vitest coverage, CI without Docker DNS for `redis`).
 *
 * Env: {@link shouldUseNoopGatewayRedis} — `OCH_DISABLE_EXTERNALS=1` or `VITEST=true`.
 */
import { createClient, type RedisClientType } from "redis";

export function shouldUseNoopGatewayRedis(): boolean {
  return process.env.OCH_DISABLE_EXTERNALS === "1" || process.env.OCH_DISABLE_EXTERNALS === "true";
}

/**
 * Minimal `redis` v4 client surface used by `server.ts` and cluster-weight middleware.
 * `isOpen` true after `connect`; `get`/`eval` resolve without I/O; `on` ignores errors.
 */
export function createNoopGatewayRedis(): RedisClientType {
  const client = {
    isOpen: false,
    on(_ev: string, _fn: (err: unknown) => void) {
      return client as unknown as RedisClientType;
    },
    async connect() {
      (client as { isOpen: boolean }).isOpen = true;
    },
    async disconnect(): Promise<void> {
      (client as { isOpen: boolean }).isOpen = false;
    },
    async quit(): Promise<void> {
      (client as { isOpen: boolean }).isOpen = false;
    },
    async get(_key: string): Promise<string | null> {
      return null;
    },
    async set(_key: string, _value: string, _opts?: unknown): Promise<void> {},
    async eval(_script: string, opts?: { keys?: string[]; arguments?: string[] }): Promise<number> {
      void _script;
      void opts;
      // Cluster weight Lua: return 1 = acquired (fail-open allow traffic without real Redis)
      return 1;
    },
  };
  return client as unknown as RedisClientType;
}

export function createGatewayRedis(url: string): RedisClientType {
  if (shouldUseNoopGatewayRedis()) {
    console.error("[gateway-redis] OCH_DISABLE_EXTERNALS=1 — using in-memory noop Redis (no TCP/DNS)");
    return createNoopGatewayRedis();
  }
  return createClient({ url, socket: { connectTimeout: 10_000 } });
}
