import {
  makeLifecycleEventClaimer,
  startUserLifecycleConsumer,
  type UserLifecycleKafkaConsumer,
} from "@common/utils";
import { pool } from "./db.js";

export function startListingsUserLifecycleConsumer(): Promise<UserLifecycleKafkaConsumer | null> {
  return startUserLifecycleConsumer({
    serviceLabel: "listings-service",
    groupId: process.env.USER_LIFECYCLE_KAFKA_GROUP || "listings-service-user-lifecycle",
    claimEvent: makeLifecycleEventClaimer(pool, "listings"),
    onUserAccountDeleted: async (userId: string) => {
      await pool.query(
        `UPDATE listings.listings
         SET status = 'closed'::listings.listing_status, updated_at = now()
         WHERE user_id = $1::uuid
           AND status IN ('active'::listings.listing_status, 'paused'::listings.listing_status)`,
        [userId],
      );
    },
  });
}
