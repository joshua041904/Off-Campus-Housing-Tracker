/**
 * Transport v2 — observe HTTP/2 on GET /api/readyz (ALPN / httpVersion HTTP/2).
 *   SSL_CERT_FILE=certs/dev-root.pem k6 run scripts/load/k6-transport-h2.js
 */
import http from "k6/http";
import { check } from "k6";
import { defaultRawBase, mergeEdgeTlsWithProtocol, strictEdgeTlsOptions } from "./k6-strict-edge-tls.js";

const RAW_BASE = defaultRawBase();
const BASE = RAW_BASE.replace(/\/$/, "");

export const options = Object.assign({}, strictEdgeTlsOptions(RAW_BASE), {
  vus: 1,
  iterations: 1,
  thresholds: { checks: ["rate==1.0"] },
});

export default function () {
  const url = `${BASE}/api/readyz`;
  const res = http.get(url, mergeEdgeTlsWithProtocol(RAW_BASE, "http2", { timeout: "20s" }));
  check(res, {
    "status 200": (r) => r.status === 200,
    "proto is HTTP/2.0": (r) => String(r.proto || "").trim() === "HTTP/2.0",
  });
}
