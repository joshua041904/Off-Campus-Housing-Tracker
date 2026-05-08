/**
 * Shared Jaeger HTTP helpers for trace validators (no Vitest / Rollup).
 *
 * Node's global `fetch()` does not automatically trust `certs/dev-root.pem` for
 * `https://off-campus-housing.test/jaeger` (edge Jaeger). Curl does when given `--cacert`.
 * Use `https.request` with the dev CA (or NODE_EXTRA_CA_CERTS) for HTTPS Jaeger Query URLs.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";
import https from "node:https";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function defaultRepoRoot() {
  return join(__dirname, "..", "..", "..");
}

function readDevCaPem() {
  const fromEnv = process.env.NODE_EXTRA_CA_CERTS;
  if (fromEnv && existsSync(fromEnv)) return readFileSync(fromEnv);
  const repo = process.env.REPO_ROOT || defaultRepoRoot();
  const p = join(repo, "certs", "dev-root.pem");
  if (existsSync(p)) return readFileSync(p);
  return null;
}

function fetchJsonHttps(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const ca = readDevCaPem();
    const opts = {
      hostname: u.hostname,
      port: u.port ? Number(u.port) : 443,
      path: `${u.pathname}${u.search}`,
      method: "GET",
      servername: u.hostname,
      rejectUnauthorized: true,
    };
    if (ca) opts.ca = ca;
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try {
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error(`GET ${url} → ${res.statusCode}`));
            return;
          }
          const body = Buffer.concat(chunks).toString("utf8");
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`GET ${url} → timeout`));
    });
    req.end();
  });
}

export async function fetchJson(url, timeoutMs = 45_000) {
  if (url.startsWith("https://")) {
    return fetchJsonHttps(url, timeoutMs);
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

export function buildTracesUrl(base, service, lookbackSec, limit) {
  const end = Date.now() * 1000;
  const start = (Date.now() - lookbackSec * 1000) * 1000;
  const enc = encodeURIComponent(service);
  return `${base.replace(/\/$/, "")}/api/traces?service=${enc}&start=${start}&end=${end}&limit=${limit}`;
}

export function tagValue(span, wantKey) {
  const tags = span.tags || [];
  const w = wantKey.toLowerCase();
  for (const t of tags) {
    if (String(t.key || "").toLowerCase() === w) return t.value;
  }
  return undefined;
}

export function serviceName(span, processes) {
  const pid = span.processID;
  const p = processes?.[pid];
  return p?.serviceName || "";
}

export function spanMap(spans) {
  const m = new Map();
  for (const s of spans) {
    m.set(String(s.spanID), s);
    if (s.spanID != null) m.set(s.spanID, s);
  }
  return m;
}

/** Jaeger trace: { traceID, spans, processes } */
export function normalizeTrace(raw) {
  if (!raw) return null;
  if (raw.traceID && raw.spans) return raw;
  if (Array.isArray(raw.spans) && raw.spans[0]?.traceID) {
    return {
      traceID: raw.spans[0].traceID,
      spans: raw.spans,
      processes: raw.processes || {},
    };
  }
  return null;
}

/** Normalize trace id for Jaeger `/api/traces/{id}` (32 hex, strip 0x, lowercase). */
export function normTraceId(id) {
  return String(id || "")
    .replace(/^0x/i, "")
    .toLowerCase();
}

/** Fetch a single trace by id (Jaeger Query HTTP API). */
export async function fetchTraceById(base, tid) {
  const id = normTraceId(tid);
  if (!id) return null;
  const url = `${base.replace(/\/$/, "")}/api/traces/${encodeURIComponent(id)}`;
  try {
    const j = await fetchJson(url);
    if (Array.isArray(j.data) && j.data[0]) return normalizeTrace(j.data[0]);
    if (j.traceID && j.spans) return normalizeTrace(j);
  } catch {
    /* empty */
  }
  return null;
}
