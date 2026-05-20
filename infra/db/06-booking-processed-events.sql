-- Booking service: Kafka consumer idempotency (user.lifecycle.v1, booking events, etc.).
-- Run after 03-booking-outbox.sql. Matches services/booking-service/prisma/migrations/20260330104500_booking_processed_events.

CREATE TABLE IF NOT EXISTS booking.processed_events (
  event_id     UUID PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE booking.processed_events IS 'Idempotent consumer: INSERT event_id ON CONFLICT DO NOTHING before handle; see docs/OUTBOX_PUBLISHER_AND_CONSUMER_CONTRACT.md';
