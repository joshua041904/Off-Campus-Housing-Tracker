import {
  startUserLifecycleConsumer,
  type UserLifecycleKafkaConsumer,
} from "@common/utils";
import { prisma } from "./lib/prisma.js";

async function claimLifecycleEvent(eventId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ event_id: string }[]>`
    INSERT INTO booking.processed_events (event_id) VALUES (${eventId}::uuid)
    ON CONFLICT (event_id) DO NOTHING
    RETURNING event_id
  `;
  return rows.length > 0;
}

export function startBookingUserLifecycleConsumer(): Promise<UserLifecycleKafkaConsumer | null> {
  return startUserLifecycleConsumer({
    serviceLabel: "booking-service",
    groupId: process.env.USER_LIFECYCLE_KAFKA_GROUP || "booking-service-user-lifecycle",
    claimEvent: claimLifecycleEvent,
    onUserAccountDeleted: async (userId: string) => {
      await prisma.$executeRaw`
        UPDATE booking.bookings SET
          status = 'cancelled'::booking.booking_status,
          cancelled_at = NOW(),
          cancellation_reason = 'user_account_deleted',
          updated_at = NOW()
        WHERE (tenant_id = ${userId}::uuid OR landlord_id = ${userId}::uuid)
          AND start_date > CURRENT_DATE
          AND status IN (
            'created'::booking.booking_status,
            'pending_confirmation'::booking.booking_status,
            'confirmed'::booking.booking_status
          )
      `;
    },
  });
}
