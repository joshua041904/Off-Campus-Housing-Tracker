-- Saved-search alert preferences (max distance in miles + notify on new listings).
ALTER TABLE booking.search_history
  ADD COLUMN IF NOT EXISTS alert_on_match boolean NOT NULL DEFAULT false;

ALTER TABLE booking.search_history
  ADD COLUMN IF NOT EXISTS max_campus_miles double precision;

COMMENT ON COLUMN booking.search_history.alert_on_match IS 'When true, new listings that match this saved search may trigger in-app notifications.';
COMMENT ON COLUMN booking.search_history.max_campus_miles IS 'Optional max distance from campus (miles) for matching; null means no distance cap.';
