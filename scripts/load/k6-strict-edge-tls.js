/**
 * Strict TLS helpers for k6 → Caddy edge (dev / rotated CA).
 *
 * IMPORTANT (k6 ≤ v1.4.x, standard `k6/http`): **Per-request `params.tls` is ignored.**
 * The JS HTTP client only reads: cookies, headers, jar, compression, redirects, tags,
 * auth, timeout, throw, responseType, responseCallback — see `js/modules/k6/http/request.go`.
 * gRPC (`k6/net/grpc`) does support `tls: { cacerts }`; HTTP does not.
 *
 * What actually works:
 * - **Linux / k6 in Docker**: `SSL_CERT_FILE=/abs/path/to/dev-root.pem` — Go uses it for the default TLS client.
 * - **macOS (host k6)**: Go uses Security.framework, **not** SSL_CERT_FILE. Trust `dev-root.pem` in the
 *   login keychain: `./scripts/lib/trust-dev-root-ca-macos.sh` (run by edge smoke scripts), or set
 *   `K6_USE_DOCKER_K6=1` to run the official `grafana/k6` image (Linux + SSL_CERT_FILE).
 *
 * Env: K6_RESOLVE, K6_INSECURE_SKIP_TLS, BASE_URL, K6_TLS_CA_CERT (for docs / future gRPC), SSL_CERT_FILE (shell)
 */
export const EDGE_HOST_DEFAULT = "off-campus-housing.test";

export function defaultRawBase() {
  return (__ENV.BASE_URL || `https://${EDGE_HOST_DEFAULT}`).replace(/\/$/, "");
}

/** True when using raw https://<IP>/... (JWT scripts) or explicit insecure flag. */
export function shouldSkipTlsVerify(rawBase) {
  return (
    (__ENV.K6_INSECURE_SKIP_TLS || "0") === "1" ||
    /^https:\/\/[\d.]+(:\d+)?(\/|$)/.test(rawBase)
  );
}

export function parseHostsFromResolveString(k6Resolve) {
  if (!k6Resolve || typeof k6Resolve !== "string") return {};
  const parts = k6Resolve.split(":");
  if (parts.length < 3) return {};
  const host = parts[0];
  const ip = parts[parts.length - 1];
  if (!host || !ip) return {};
  return { [host]: ip };
}

export function caCertPath() {
  return __ENV.K6_TLS_CA_CERT || __ENV.K6_CA_ABSOLUTE || "certs/dev-root.pem";
}

/**
 * Global `export const options = { ...strictEdgeTlsOptions(rawBase), ... }`.
 * - `hosts` from K6_RESOLVE (MetalLB pin).
 * - `insecureSkipTLSVerify: true` only for IP URL or K6_INSECURE_SKIP_TLS=1 (**global** option — k6 HTTP honors this).
 */
export function strictEdgeTlsOptions(rawBase) {
  const hosts = parseHostsFromResolveString(__ENV.K6_RESOLVE || "");
  const out = {};
  if (Object.keys(hosts).length) out.hosts = hosts;
  if (shouldSkipTlsVerify(rawBase)) {
    out.insecureSkipTLSVerify = true;
  }
  return out;
}

/**
 * Merge hook for per-request params. k6 HTTP ignores `tls` here; kept for API stability and gRPC scripts
 * that may pass the same object shape elsewhere.
 */
export function mergeEdgeTls(_rawBase, extra = {}) {
  return { ...extra };
}
