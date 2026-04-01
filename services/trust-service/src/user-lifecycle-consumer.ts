import {
  makeLifecycleEventClaimer,
  startUserLifecycleConsumer,
  type UserLifecycleKafkaConsumer,
} from "@common/utils";
import { pool } from "./db.js";

/** Preserve reviews/flags; display layer uses auth deletion state. */
export function startTrustUserLifecycleConsumer(): Promise<UserLifecycleKafkaConsumer | null> {
  return startUserLifecycleConsumer({
    serviceLabel: "trust-service",
    groupId: process.env.USER_LIFECYCLE_KAFKA_GROUP || "trust-service-user-lifecycle",
    claimEvent: makeLifecycleEventClaimer(pool, "trust"),
    onUserAccountDeleted: async (_userId: string) => {
      /* intentional no-op */
    },
  });
}
