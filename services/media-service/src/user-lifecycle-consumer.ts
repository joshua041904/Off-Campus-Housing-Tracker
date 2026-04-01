import {
  makeLifecycleEventClaimer,
  startUserLifecycleConsumer,
  type UserLifecycleKafkaConsumer,
} from "@common/utils";
import { pool } from "./db/mediaRepo.js";

export function startMediaUserLifecycleConsumer(): Promise<UserLifecycleKafkaConsumer | null> {
  return startUserLifecycleConsumer({
    serviceLabel: "media-service",
    groupId: process.env.USER_LIFECYCLE_KAFKA_GROUP || "media-service-user-lifecycle",
    claimEvent: makeLifecycleEventClaimer(pool, "media"),
    onUserAccountDeleted: async (userId: string) => {
      await pool.query(`DELETE FROM media.media_files WHERE user_id = $1::uuid`, [userId]);
    },
  });
}
