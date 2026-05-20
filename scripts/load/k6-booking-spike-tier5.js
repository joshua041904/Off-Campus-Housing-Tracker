import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE_URL = (__ENV.BASE_URL || "https://off-campus-housing.test").replace(/\/+$/, "");
const LISTING_ID = __ENV.LISTING_ID || "00000000-0000-0000-0000-000000000001";
const JWT = __ENV.JWT || "";
const BOOKING_PATH = __ENV.BOOKING_PATH || "/api/booking/request";
const QUICK = (__ENV.K6_QUICK || "0") === "1";
const bookingLockLatencyMs = new Trend("booking_lock_latency_ms");
const bookingKafkaPublishLatencyMs = new Trend("booking_kafka_publish_latency_ms");
const bookingNotificationPushLatencyMs = new Trend("booking_notification_push_latency_ms");

export const options = {
  scenarios: {
    booking_spike_day: {
      executor: "ramping-arrival-rate",
      startRate: 5,
      timeUnit: "1s",
      preAllocatedVUs: 200,
      maxVUs: 1200,
      stages: [
        ...(QUICK
          ? [
              { duration: "20s", target: 8 },
              { duration: "40s", target: 12 },
              { duration: "20s", target: 0 },
            ]
          : [
              { duration: "2m", target: 20 },
              { duration: "8m", target: 40 },
              { duration: "10m", target: 40 },
              { duration: "5m", target: 15 },
              { duration: "2m", target: 0 },
            ]),
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.03"],
    http_req_duration: ["p(95)<400"],
    booking_lock_latency_ms: ["p(95)<5"],
    booking_kafka_publish_latency_ms: ["p(95)<20"],
    booking_notification_push_latency_ms: ["p(95)<200"],
  },
};

function headers() {
  const h = { "Content-Type": "application/json" };
  if (JWT) h.Authorization = `Bearer ${JWT}`;
  return h;
}

export default function () {
  const payload = JSON.stringify({
    listingId: LISTING_ID,
    message: "Tier5 spike booking request",
  });
  const res = http.post(`${BASE_URL}${BOOKING_PATH}`, payload, { headers: headers() });
  bookingLockLatencyMs.add(Number(res.headers["X-Booking-Lock-Latency-Ms"] || 0));
  bookingKafkaPublishLatencyMs.add(Number(res.headers["X-Booking-Kafka-Publish-Latency-Ms"] || 0));
  bookingNotificationPushLatencyMs.add(Number(res.headers["X-Booking-Notification-Push-Latency-Ms"] || 0));
  check(res, {
    "booking accepted or pending": (r) => r.status === 200 || r.status === 201 || r.status === 202 || r.status === 409,
  });
  sleep(0.2);
}
