/**
 * Gateway JWT for analytics QA: idempotent register + login, memory cache, optional disk cache.
 *
 * Env:
 *   BASE_URL                      — gateway origin (required for auth)
 *   ANALYTICS_QA_TLS_INSECURE=1   — see bootstrap-tls.mjs
 *   ANALYTICS_QA_EMAIL            — default qa-user@test.com
 *   ANALYTICS_QA_PASSWORD         — default TestPass123!
 *   ANALYTICS_QA_REGISTER=0       — skip auto-register (login only)
 *   ANALYTICS_QA_TOKEN_CACHE=0    — disable bench_logs/qa-token.json
 *   ANALYTICS_QA_TOKEN_CACHE_PATH — override cache file path
 */
import "./bootstrap-tls.mjs";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

let memoryToken = null;
let memoryExpMs = 0;
/** Single-flight so concurrent stress workers share one login. */
let authInflight = null;

const TOKEN_CACHE_PATH = process.env.ANALYTICS_QA_TOKEN_CACHE_PATH?.trim() || "bench_logs/qa-token.json";
const TOKEN_CACHE_DISABLED = process.env.ANALYTICS_QA_TOKEN_CACHE === "0";

export function qaBaseUrl() {
  const u = (process.env.BASE_URL ?? "http://127.0.0.1:4020").replace(/\/$/, "");
  if (!u) throw new Error("[qa-auth] BASE_URL is empty");
  return u;
}

function decodeJwtExpMs(token) {
  try {
    const p = token.split(".")[1];
    if (!p) return 0;
    const pad = p.length % 4 === 0 ? "" : "=".repeat(4 - (p.length % 4));
    const json = JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8"));
    const exp = Number(json.exp);
    return Number.isFinite(exp) ? exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function loadDiskCache() {
  if (TOKEN_CACHE_DISABLED) return null;
  try {
    if (!existsSync(TOKEN_CACHE_PATH)) return null;
    const raw = JSON.parse(readFileSync(TOKEN_CACHE_PATH, "utf8"));
    const token = String(raw.token || "");
    const expMs = Number(raw.exp_ms || 0);
    if (!token || expMs < Date.now() + 30_000) return null;
    return { token, expMs };
  } catch {
    return null;
  }
}

function saveDiskCache(token, expMs) {
  if (TOKEN_CACHE_DISABLED) return;
  try {
    mkdirSync(dirname(TOKEN_CACHE_PATH), { recursive: true });
    writeFileSync(
      TOKEN_CACHE_PATH,
      `${JSON.stringify({ token, exp_ms: expMs, saved_at: Date.now() })}\n`,
      "utf8",
    );
  } catch (e) {
    console.warn("[qa-auth] token cache write failed:", (e && e.message) || e);
  }
}

async function postJson(path, body) {
  const root = qaBaseUrl();
  const p = path.startsWith("/") ? path : `/${path}`;
  return fetch(`${root}${p}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function extractToken(json) {
  const t = json?.token;
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

async function fetchFreshToken() {
  const email = process.env.ANALYTICS_QA_EMAIL?.trim() || "qa-user@test.com";
  const password = process.env.ANALYTICS_QA_PASSWORD?.trim() || "TestPass123!";
  const allowRegister = process.env.ANALYTICS_QA_REGISTER !== "0";

  let res = await postJson("/api/auth/login", { email, password });

  if (res.ok) {
    const json = await res.json().catch(() => ({}));
    if (json.requiresMFA === true) {
      throw new Error(
        "[qa-auth] Login requires MFA. Use ANALYTICS_QA_BEARER_TOKEN with a pre-issued JWT or a non-MFA QA account.",
      );
    }
    const tok = extractToken(json);
    if (tok) return tok;
    throw new Error("[qa-auth] Login succeeded but response had no token (check auth / gateway contract).");
  }

  if (res.status === 401 && allowRegister) {
    const reg = await postJson("/api/auth/register", { email, password });
    const regTxt = await reg.text().catch(() => "");
    const alreadyExists = /exist|already/i.test(regTxt);
    if (!reg.ok && reg.status !== 409 && !alreadyExists) {
      throw new Error(`[qa-auth] Register failed: HTTP ${reg.status} ${regTxt.slice(0, 600)}`);
    }

    res = await postJson("/api/auth/login", { email, password });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`[qa-auth] Login after register failed: HTTP ${res.status} ${t.slice(0, 600)}`);
    }
    const json = await res.json().catch(() => ({}));
    if (json.requiresMFA === true) {
      throw new Error("[qa-auth] Login requires MFA after register.");
    }
    const tok = extractToken(json);
    if (tok) return tok;
    throw new Error("[qa-auth] Login after register missing token.");
  }

  if (res.status === 401 && !allowRegister) {
    const hint = await res.text().catch(() => "");
    throw new Error(
      `[qa-auth] Login returned 401 (ANALYTICS_QA_REGISTER=0). Fix ANALYTICS_QA_EMAIL/PASSWORD or unset ANALYTICS_QA_REGISTER. ${hint.slice(0, 300)}`,
    );
  }

  const txt = await res.text().catch(() => "");
  throw new Error(`[qa-auth] Login failed: HTTP ${res.status} ${txt.slice(0, 600)}`);
}

export async function getBearerToken() {
  const now = Date.now();
  const skew = 15_000;

  if (memoryToken && memoryExpMs > now + skew) return memoryToken;

  const disk = loadDiskCache();
  if (disk && disk.expMs > now + skew) {
    memoryToken = disk.token;
    memoryExpMs = disk.expMs;
    return memoryToken;
  }

  if (!authInflight) {
    authInflight = (async () => {
      const token = await fetchFreshToken();
      const jwtExp = decodeJwtExpMs(token);
      const expMs = jwtExp > now ? jwtExp : now + 3_600_000;
      memoryToken = token;
      memoryExpMs = expMs;
      saveDiskCache(token, expMs);
      return token;
    })().finally(() => {
      authInflight = null;
    });
  }

  return authInflight;
}

/** Cold-path warmup: readyz + analytics health in parallel (best-effort). */
export async function qaAuthWarmup() {
  const b = qaBaseUrl();
  await Promise.all([
    fetch(`${b}/api/readyz`).catch(() => {}),
    fetch(`${b}/api/analytics/healthz`).catch(() => {}),
  ]);
}
