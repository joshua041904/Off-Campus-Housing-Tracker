/**
 * Transport v2 — observe HTTP/1.1 on GET /api/readyz (forced httpVersion via mergeEdgeTlsWithProtocol).
 *   SSL_CERT_FILE=certs/dev-root.pem k6 run scripts/load/k6-transport-h1.js
 */
import http from "k6/http";
import { check } from "k6";
import { defaultRawBase, mergeEdgeTlsWithProtocol, strictEdgeTlsOptions } from "./k6-strict-edge-tls.js";

const RAW_BASE = defaultRawBase();
const BASE = RAW_BASE.replace(/\/$/, "");

// noConnectionReuse: avoid connection pooling so ALPN cannot silently stick to HTTP/2 from a prior socket.
// Prefer SSL_CERT_FILE for strict TLS; set K6_INSECURE_SKIP_TLS_VERIFY=1 if your k6 build ignores the CA file.
const _insecure = String(__ENV.K6_INSECURE_SKIP_TLS_VERIFY || "").trim() === "1";
export const options = Object.assign({}, strictEdgeTlsOptions(RAW_BASE), {
  vus: 1,
  iterations: 1,
  thresholds: { checks: ["rate==1.0"] },
  noConnectionReuse: true,
  insecureSkipTLSVerify: _insecure,
});

export default function () {
  const url = `${BASE}/api/readyz`;
  const res = http.get(url, mergeEdgeTlsWithProtocol(RAW_BASE, "http1", { timeout: "20s" }));
  check(res, {
    "status 200": (r) => r.status === 200,
    "proto is HTTP/1.1": (r) => String(r.proto || "").trim() === "HTTP/1.1",
  });
}
