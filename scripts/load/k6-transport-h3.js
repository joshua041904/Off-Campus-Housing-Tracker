/**
 * Transport v2 — observe HTTP/3 (QUIC) on GET /api/readyz via xk6-http3 when available.
 * Requires: .k6-build/k6-http3 (see scripts/build-k6-http3.sh).
 *   SSL_CERT_FILE=certs/dev-root.pem .k6-build/k6-http3 run scripts/load/k6-transport-h3.js
 */
import http from "k6/http";
import { check } from "k6";
import { defaultRawBase, mergeEdgeTls, strictEdgeTlsOptions } from "./k6-strict-edge-tls.js";

let http3 = null;
try {
  http3 = require("k6/x/http3");
} catch (_e) {
  http3 = null;
}

export function setup() {
  if (__ENV.K6_HTTP3_REQUIRE_MODULE === "1" && !http3) {
    throw new Error("k6/x/http3 required — run with .k6-build/k6-http3 (scripts/build-k6-http3.sh)");
  }
}

const RAW_BASE = defaultRawBase();
const BASE = RAW_BASE.replace(/\/$/, "");

export const options = Object.assign({}, strictEdgeTlsOptions(RAW_BASE), {
  vus: 1,
  iterations: 1,
  thresholds: { checks: ["rate==1.0"] },
});

export default function () {
  const url = `${BASE}/api/readyz`;
  const params = mergeEdgeTls(RAW_BASE, {
    tags: { name: "transport_v2_h3" },
    timeout: "25s",
  });

  let r;
  if (http3) {
    r = http3.get(url, params);
  } else {
    r = http.get(url, params);
  }

  check(r, {
    "status 200": (res) => res.status === 200,
    "HTTP/3 or unset proto when xk6-http3": (res) => {
      if (http3) {
        const p = String(res.proto || res.protocol || "").trim();
        if (!p) return true;
        const low = p.toLowerCase();
        return low.includes("http/3") || low.includes("h3") || low.includes("quic");
      }
      return false;
    },
  });
}
