import client from "prom-client";
import { register } from "@common/utils";

export const bookingRequestsTotal = new client.Counter({
  name: "booking_requests_total",
  help: "Total booking requests created via POST /request",
});

export const bookingFraudFlaggedTotal = new client.Counter({
  name: "booking_fraud_flagged_total",
  help: "Booking requests flagged as high fraud risk",
});

export const bookingExpiredTotal = new client.Counter({
  name: "booking_expired_total",
  help: "Bookings transitioned to EXPIRED by the lifecycle cron",
});

/** Increment when a booking enters a domain status (create + each transition). */
export const bookingStatusTotal = new client.Counter({
  name: "booking_status_total",
  help: "Booking lifecycle entries by public domain status",
  labelNames: ["status"],
});

for (const m of [bookingRequestsTotal, bookingFraudFlaggedTotal, bookingExpiredTotal, bookingStatusTotal]) {
  register.registerMetric(m);
}

export function recordBookingEnteredDomainStatus(status: string): void {
  bookingStatusTotal.inc({ status });
}
