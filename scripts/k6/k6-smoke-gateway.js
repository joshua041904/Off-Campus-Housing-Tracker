import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 5,
  duration: "20s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<2000"],
  },
};

const BASE =
  __ENV.BASE_URL ||
  "http://api-gateway.off-campus-housing-tracker.svc.cluster.local:4020";

export default function () {
  const res = http.get(`${BASE}/healthz`);
  check(res, { "status is 200": (r) => r.status === 200 });
  sleep(0.3);
}
