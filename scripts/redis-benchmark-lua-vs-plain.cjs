#!/usr/bin/env node
/**
 * Compare Redis round-trips: Lua incr-under-cap (single EVAL) vs plain GET + conditional INCRBY + EXPIRE (3 commands).
 * Mirrors semantics in services/common/src/redis-lua.ts (LUA_INCR_CAP).
 *
 * Usage (from repo root):
 *   node scripts/redis-benchmark-lua-vs-plain.cjs
 * Env: REDIS_HOST (127.0.0.1), REDIS_PORT (6380), BENCHMARK_OPS (default 30000), KEY_PREFIX (bench:lua:)
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const fs = require("fs");

const repoRoot = path.resolve(__dirname, "..");
const ioredisPath = path.join(repoRoot, "services/common/node_modules/ioredis");
if (!fs.existsSync(ioredisPath)) {
  console.error("Missing ioredis. Run: pnpm install (from repo root)");
  process.exit(1);
}
// eslint-disable-next-line import/no-dynamic-require
const Redis = require(ioredis);

const LUA_INCR_CAP = `
local v = redis.call("incrby", KEYS[1], tonumber(ARGV[1]))
if v > tonumber(ARGV[2]) then
  redis.call("decrby", KEYS[1], tonumber(ARGV[1]))
  return -1
end
redis.call("pexpire", KEYS[1], tonumber(ARGV[3]))
return v
`;

const host = process.env.REDIS_HOST || "127.0.0.1";
const port = Number(process.env.REDIS_PORT || 6380);
const OPS = Number(process.env.BENCHMARK_OPS || 30000);
const PREFIX = process.env.KEY_PREFIX || "bench:lua:";
const CAP = 1_000_000;
const TTL_MS = 60_000;
const DELTA = 1;

async function run() {
  const r = new Redis({ host, port, maxRetriesPerRequest: 1, enableReadyCheck: true });
  try {
    await r.ping();
  } catch (e) {
    console.error(`Redis not reachable at ${host}:${port} — start docker compose (redis 6380).`, e.message);
    process.exit(1);
  }

  const keyLua = `${PREFIX}lua`;
  const keyPlain = `${PREFIX}plain`;
  await r.del(keyLua, keyPlain);

  const t0 = process.hrtime.bigint();
  for (let i = 0; i < OPS; i++) {
    await r.eval(LUA_INCR_CAP, 1, keyLua, String(DELTA), String(CAP), String(TTL_MS));
  }
  const t1 = process.hrtime.bigint();
  const luaMs = Number(t1 - t0) / 1e6;

  await r.del(keyPlain);
  const t2 = process.hrtime.bigint();
  for (let i = 0; i < OPS; i++) {
    const cur = await r.get(keyPlain);
    const n = cur ? Number(cur) : 0;
    if (n + DELTA > CAP) {
      continue;
    }
    await r.incrby(keyPlain, DELTA);
    await r.pexpire(keyPlain, TTL_MS);
  }
  const t3 = process.hrtime.bigint();
  const plainMs = Number(t3 - t2) / 1e6;

  await r.del(keyLua, keyPlain);
  await r.quit();

  const ratio = plainMs / luaMs;
  return {
    ops: OPS,
    luaMs,
    plainMs,
    luaRps: (OPS / luaMs) * 1000,
    plainRps: (OPS / plainMs) * 1000,
    ratio,
  };
}

run()
  .then((out) => {
    console.log(JSON.stringify(out, null, 2));
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
