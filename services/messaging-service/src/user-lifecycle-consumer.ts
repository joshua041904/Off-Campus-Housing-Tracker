import {
  makeLifecycleEventClaimer,
  startUserLifecycleConsumer,
  type UserLifecycleKafkaConsumer,
} from "@common/utils";
import { pool } from "./lib/db.js";

/** No row rewrites: anonymization is render-time from auth is_deleted (see design doc). */
export function startMessagingUserLifecycleConsumer(): Promise<UserLifecycleKafkaConsumer | null> {
  return startUserLifecycleConsumer({
    serviceLabel: "messaging-service",
    groupId: process.env.USER_LIFECYCLE_KAFKA_GROUP || "messaging-service-user-lifecycle",
    claimEvent: makeLifecycleEventClaimer(pool, "messaging"),
    onUserAccountDeleted: async (_userId: string) => {
      /* intentional no-op */
    },
  });
}
