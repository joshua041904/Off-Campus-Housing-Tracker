import {
  makeLifecycleEventClaimer,
  startUserLifecycleConsumer,
  type UserLifecycleKafkaConsumer,
} from "@common/utils";
import type { Pool } from "pg";

export function startNotificationUserLifecycleConsumer(
  pool: Pool | null,
): Promise<UserLifecycleKafkaConsumer | null> {
  if (!pool) return Promise.resolve(null);
  return startUserLifecycleConsumer({
    serviceLabel: "notification-service",
    groupId:
      process.env.NOTIFICATION_USER_LIFECYCLE_KAFKA_GROUP ||
      "notification-service-user-lifecycle",
    claimEvent: makeLifecycleEventClaimer(pool, "notification"),
    onUserAccountDeleted: async (userId: string) => {
      await pool.query(`DELETE FROM notification.notifications WHERE user_id = $1::uuid`, [
        userId,
      ]);
    },
  });
}
