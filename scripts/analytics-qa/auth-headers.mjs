/**
 * Headers for gateway-proxied analytics QA.
 *
 *   ANALYTICS_QA_BEARER_TOKEN — optional override (skips auto login/register)
 *
 * Otherwise uses scripts/analytics-qa/auth-client.mjs (register-if-needed + login + cache).
 */
import "./bootstrap-tls.mjs";
import { getBearerToken } from "./auth-client.mjs";

function fetchErrCode(err) {
  return String(err?.cause?.code ?? err?.code ?? "");
}

/**
 * Long-running analytics POSTs via the TLS edge: undici occasionally sees ECONNRESET between
 * sequential multi-minute responses; curl stays healthy. Retry + Connection: close on headers.
 */
export async function analyticsQaFetch(url, init = {}) {
  const max = Math.max(1, Math.min(15, Number(process.env.ANALYTICS_QA_FETCH_RETRIES ?? "10")));
  let last;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      last = e;
      const code = fetchErrCode(e);
      const retry =
        attempt < max &&
        (code === "ECONNRESET" ||
          code === "ECONNREFUSED" ||
          code === "ETIMEDOUT" ||
          code === "EPIPE" ||
          code === "UND_ERR_SOCKET");
      if (!retry) throw e;
      await new Promise((r) => setTimeout(r, Math.min(25_000, 800 * attempt ** 2)));
    }
  }
  throw last;
}

export async function analyticsQaHeaders(base = {}) {
  // Avoid undici/TLS connection reuse across long gateway ↔ analytics streams (edge may RST idle pooled sockets).
  const headers = { Connection: "close", ...base };
  const raw = process.env.ANALYTICS_QA_BEARER_TOKEN?.trim();
  if (raw) {
    headers.Authorization = /^Bearer\s+/i.test(raw) ? raw : `Bearer ${raw}`;
    return headers;
  }
  const token = await getBearerToken();
  headers.Authorization = `Bearer ${token}`;
  return headers;
}
