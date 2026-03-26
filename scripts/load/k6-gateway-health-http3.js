/**
 * k6: API gateway GET /api/healthz over HTTP/3 (QUIC) via xk6-http3 extension (import k6/x/http3).
 *
 * Requires the custom binary from ./scripts/build-k6-http3.sh (xk6 + bandorko/xk6-http3).
 * Same artifact as preflight step 6d / run-k6-phases.sh — typically .k6-build/bin/k6-http3.
 * Docs: docs/XK6_HTTP3_SETUP.md
 *
 * run-k6-protocol-matrix.sh sets K6_HTTP3_REQUIRE_MODULE=1 so a vanilla k6 run fails fast
 * instead of silently falling back to HTTP/1.1 or HTTP/2.
 */
import http from "k6/http";
import { check, sleep } from "k6";
import {
  defaultRawBase,
  mergeEdgeTls,
  strictEdgeTlsOptions,
} from "./k6-strict-edge-tls.js";

let http3 = null;
try {
  http3 = require("k6/x/http3");
} catch (_e) {
  http3 = null;
}

export function setup() {
  if (__ENV.K6_HTTP3_REQUIRE_MODULE === "1" && !http3) {
    throw new Error(
      "k6/x/http3 missing — this script must run with the xk6-http3 binary (./scripts/build-k6-http3.sh → .k6-build/bin/k6-http3). See docs/XK6_HTTP3_SETUP.md",
    );
  }
  console.log(
    `[gateway-health-http3] env PROTOCOL=${JSON.stringify(__ENV.PROTOCOL)} PROTOCOL_MODE=${JSON.stringify(__ENV.PROTOCOL_MODE)} K6_PROTOCOL=${JSON.stringify(__ENV.K6_PROTOCOL)} http3_module=${Boolean(http3)}`,
  );
}

const RAW_BASE = defaultRawBase();
const BASE = RAW_BASE;
const DUR = __ENV.DURATION || "25s";
const VUS = Number(__ENV.VUS || 6);

// k6's bundled Babel does not support object spread in options — use Object.assign (see docs/XK6_HTTP3_SETUP.md).
export const options = Object.assign({}, strictEdgeTlsOptions(RAW_BASE), {
  insecureSkipTLSVerify: false,
  tlsAuth: [],
  vus: VUS,
  duration: DUR,
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<800", "p(99)<3000"],
  },
});

export default function () {
  const url = `${BASE}/api/healthz`;
  const params = mergeEdgeTls(RAW_BASE, {
    tags: {
      service: "api-gateway",
      name: http3 ? "GatewayHealthzH3" : "GatewayHealthzH3Fallback",
      k6_protocol: "http3",
    },
    timeout: "20s",
  });

  let r;
  if (http3) {
    r = http3.get(url, params);
  } else {
    r = http.get(url, params);
  }

  // One line per VU on first iteration so matrix logs show negotiated protocol without spamming.
  if (__VU === 1 && __ITER === 0) {
    console.log(`[gateway-health-http3] res.proto=${JSON.stringify(r.proto)} res.protocol=${JSON.stringify(r.protocol)} (expect HTTP/3 when k6/x/http3 is active)`);
  }

  if (http3) {
    check(r, {
      "200": (res) => res.status === 200,
      // xk6-http3 sometimes omits proto; treat empty as OK when the module handled the request.
      "HTTP/3 or unset proto": (res) => {
        const p = String(res.proto || res.protocol || "").trim();
        if (!p) return true;
        const low = p.toLowerCase();
        return low.includes("http/3") || low.includes("h3") || low.includes("quic");
      },
    });
  } else {
    check(r, { "200": (res) => res.status === 200 });
  }
  sleep(0.05);
}
