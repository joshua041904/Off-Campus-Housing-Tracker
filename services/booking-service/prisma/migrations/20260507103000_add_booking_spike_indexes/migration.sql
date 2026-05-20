CREATE INDEX IF NOT EXISTS idx_bookings_listing_status
ON booking.bookings (listing_id, status);

CREATE INDEX IF NOT EXISTS idx_bookings_created_at
ON booking.bookings (created_at);
