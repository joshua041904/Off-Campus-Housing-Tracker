#!/usr/bin/env npx tsx
/**
 * Set password for auth user(s) by email and invalidate Redis login cache.
 *
 *   pnpm exec tsx scripts/set-user-password.ts --email tomwang04312@gmail.com --password 'Tcan2004!'
 */
import { createClient } from "redis";
import pg from "pg";
import bcrypt from "bcryptjs";

const AUTH_URL = process.env.POSTGRES_URL_AUTH ?? "postgresql://postgres:postgres@127.0.0.1:5441/auth";

function arg(name: string): string {
  const i = process.argv.indexOf(name);
  if (i < 0 || !process.argv[i + 1]) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return process.argv[i + 1]!;
}

async function main(): Promise<void> {
  const email = arg("--email").trim().toLowerCase();
  const password = arg("--password");
  const hash = await bcrypt.hash(password, 8);

  const pool = new pg.Pool({ connectionString: AUTH_URL });
  const r = await pool.query(
    `UPDATE auth.users SET password_hash = $1, updated_at = now() WHERE lower(email) = $2 RETURNING id, email`,
    [hash, email],
  );
  await pool.end();
  if (!r.rowCount) {
    console.error("No user updated for", email);
    process.exit(1);
  }
  console.log("Updated password for", r.rows[0]);

  const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379/0";
  const redisPassword = process.env.REDIS_PASSWORD?.trim();
  let url = redisUrl;
  if (redisPassword && !url.includes("@")) {
    url = url.replace("redis://", `redis://:${redisPassword}@`);
  }
  try {
    const client = createClient({ url });
    await client.connect();
    const keys = await client.keys(`*${email}*`);
    if (keys.length) await client.del(keys);
    console.log("Invalidated redis keys:", keys.length);
    await client.quit();
  } catch (e) {
    console.warn("Redis cache skip:", e instanceof Error ? e.message : e);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
