/**
 * Helpers for k6 → edge hostname (strict TLS).
 *
 * Standard `k6/http` does not honor per-request `params.tls`; verification uses the process TLS store.
 * Run with `SSL_CERT_FILE=<repo>/certs/dev-root.pem` (Linux / most Docker images). On macOS, host `k6`
 * may use the system keychain — trust dev-root there, or run k6 on Linux/CI.
 *
 * Runners may pass `-e BASE_URL=https://…` (see run-housing-k6-edge-smoke.sh). If unset, defaults to
 * https://off-campus-housing.test so `k6 run scripts/load/k6-*.js` works from repo root.
 */
export function defaultRawBase() {
  const b =
    typeof __ENV.BASE_URL === "string" && __ENV.BASE_URL.startsWith("https://")
      ? __ENV.BASE_URL
      : "https://off-campus-housing.test";
  return b.replace(/\/$/, "");
}

export function caCertPath() {
  return __ENV.K6_TLS_CA_CERT || __ENV.K6_CA_ABSOLUTE || "certs/dev-root.pem";
}

/** Global options: no insecure skip, no IP/hosts hacks — rely on DNS + SSL_CERT_FILE. */
export function strictEdgeTlsOptions(_rawBase) {
  return {};
}

/**
 * Protocol hint for matrix runs: PROTOCOL_MODE=http1|http2|http3 (preferred),
 * with fallbacks K6_PROTOCOL and K6_HTTP_PROTOCOL.
 * Stock k6/http: http1 sets params.httpVersion "1.1" when supported. HTTP/3 needs k6-http3 + k6/x/http3 (separate scripts).
 */
export function protocolFromEnv() {
  const raw = (
    __ENV.PROTOCOL_MODE ||
    __ENV.PROTOCOL ||
    __ENV.K6_PROTOCOL ||
    __ENV.K6_HTTP_PROTOCOL ||
    "auto"
  ).toLowerCase();
  if (raw === "http/1.1" || raw === "http1" || raw === "h1") return "http1";
  if (raw === "http/2" || raw === "http2" || raw === "h2") return "http2";
  if (raw === "http/3" || raw === "http3" || raw === "h3" || raw === "quic") return "http3";
  return "auto";
}

/** Per-request merge hook (HTTP ignores tls here; kept for call-site consistency). */
export function mergeEdgeTls(_rawBase, extra = {}) {
  // api-gateway rate limiter skips when x-loadtest=1 (see services/api-gateway/src/server.ts)
  // k6's bundled Babel does not support object spread — use Object.assign.
  const headers = Object.assign(
    {
      Connection: "keep-alive",
      "x-loadtest": "1",
    },
    extra.headers || {},
  );
  const proto = protocolFromEnv();
  const tagProto = proto === "auto" ? "alpn" : proto;
  const tags = Object.assign({ k6_protocol: tagProto }, extra.tags || {});
  const out = Object.assign({}, extra, { headers: headers, tags: tags });
  if (proto === "http1") {
    // k6 Request params (when supported); combine with GODEBUG=http2client=0 for best-effort h1
    out.httpVersion = "HTTP/1.1";
  } else if (proto === "http2") {
    out.httpVersion = "HTTP/2";
  }
  // http3: use k6-http3 + k6/x/http3 scripts; stock k6/http does not speak QUIC
  return out;
}
