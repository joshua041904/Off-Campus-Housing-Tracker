import { markBookingNotificationContextReadApi } from "./api";
import { dispatchBookingNotificationReadEvents } from "./booking-notification-projection";

export type MarkBookingContextReadResult = {
  booking_id: string;
  read_at: string;
  affected_rows: number;
  notification_ids: string[];
};

export async function markBookingNotificationContextRead(
  token: string,
  input: {
    bookingId: string;
    notificationId?: string | null;
  },
): Promise<MarkBookingContextReadResult> {
  const bookingId = String(input.bookingId || "").trim().toLowerCase();
  const notificationId = String(input.notificationId || "").trim().toLowerCase() || undefined;
  if (!bookingId) {
    return { booking_id: "", read_at: new Date().toISOString(), affected_rows: 0, notification_ids: [] };
  }

  const response = await markBookingNotificationContextReadApi(token, { bookingId, notificationId });
  return {
    booking_id: response.booking_id,
    read_at: String(response.read_at || new Date().toISOString()),
    affected_rows: response.affected_rows,
    notification_ids: response.notification_ids,
  };
}

export async function markBookingNotificationContextReadAndDispatch(
  token: string,
  input: {
    bookingId: string;
    notificationId?: string | null;
    audience?: "tenant" | "landlord" | "unknown";
  },
): Promise<MarkBookingContextReadResult> {
  const result = await markBookingNotificationContextRead(token, input);
  const bookingId = String(result.booking_id || input.bookingId || "").trim().toLowerCase();
  if (bookingId || result.notification_ids.length > 0) {
    dispatchBookingNotificationReadEvents({
      bookingId: bookingId || undefined,
      notificationIds: result.notification_ids,
      readAt: result.read_at,
      audience: input.audience,
    });
  }
  return result;
}
