/**
 * Helpers for k6 → edge hostname (strict TLS).
 *
 * Standard `k6/http` does not honor per-request `params.tls`; verification uses the process TLS store.
 * Run with `SSL_CERT_FILE=<repo>/certs/dev-root.pem` (Linux / most Docker images). On macOS, host `k6`
 * may use the system keychain — trust dev-root there, or run k6 on Linux/CI.
 *
 * Runners must pass `-e BASE_URL=https://…` (see run-housing-k6-edge-smoke.sh). In scripts use:
 *   const BASE_URL = defaultRawBase();
 */
export function defaultRawBase() {
  const b = __ENV.BASE_URL;
  if (!b || typeof b !== "string" || !b.startsWith("https://")) {
    throw new Error(
      "k6: BASE_URL must be an https URL (e.g. run via scripts/run-housing-k6-edge-smoke.sh or k6 run -e BASE_URL=https://off-campus-housing.test …)",
    );
  }
  return b.replace(/\/$/, "");
}

export function caCertPath() {
  return __ENV.K6_TLS_CA_CERT || __ENV.K6_CA_ABSOLUTE || "certs/dev-root.pem";
}

/** Global options: no insecure skip, no IP/hosts hacks — rely on DNS + SSL_CERT_FILE. */
export function strictEdgeTlsOptions(_rawBase) {
  return {};
}

/** Per-request merge hook (HTTP ignores tls here; kept for call-site consistency). */
export function mergeEdgeTls(_rawBase, extra = {}) {
  // api-gateway rate limiter skips when x-loadtest=1 (see services/api-gateway/src/server.ts)
  const headers = { "x-loadtest": "1", ...(extra.headers || {}) };
  return { ...extra, headers };
}
