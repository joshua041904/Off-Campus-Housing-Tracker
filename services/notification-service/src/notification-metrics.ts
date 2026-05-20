import client from "prom-client";
import { register } from "@common/utils";

/** Seconds from Kafka delivery until notification persistence completes (per message). */
export const notificationConsumeLatency = new client.Histogram({
  name: "notification_consume_latency",
  help: "Kafka consumer handling latency for notification inserts (seconds)",
  buckets: client.exponentialBuckets(0.001, 2, 18),
});

register.registerMetric(notificationConsumeLatency);
