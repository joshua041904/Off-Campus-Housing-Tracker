import { Gauge } from "prom-client";
import { register } from "@common/utils";

let gauge: Gauge | undefined;

export function authOutboxUnpublishedGauge(): Gauge {
  if (!gauge) {
    const existing = register.getSingleMetric("auth_outbox_unpublished_count") as Gauge | undefined;
    if (existing) {
      gauge = existing;
    } else {
      gauge = new Gauge({
        name: "auth_outbox_unpublished_count",
        help: "Auth transactional outbox rows awaiting Kafka publish",
      });
      register.registerMetric(gauge);
    }
  }
  return gauge;
}

export function setAuthOutboxUnpublishedCount(count: number): void {
  authOutboxUnpublishedGauge().set(count);
}
