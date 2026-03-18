-- Notification service DB: preferences, delivery state, retries. Consumer-only: reacts to domain events.
-- Run against database 'notification' on port 5445:
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 5445 -U postgres -d notification -f infra/db/01-notification-schema.sql
--
-- Notification: consumes events → checks preferences → inserts notification record → attempts delivery → updates status.
-- Does NOT own booking/listing state, validate business logic, or block user flows. Idempotent processing.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS notification;

-- 1) User notification preferences
CREATE TABLE IF NOT EXISTS notification.user_preferences (
  user_id           UUID PRIMARY KEY,
  email_enabled     BOOLEAN NOT NULL DEFAULT true,
  sms_enabled       BOOLEAN NOT NULL DEFAULT false,
  push_enabled       BOOLEAN NOT NULL DEFAULT true,
  booking_alerts    BOOLEAN NOT NULL DEFAULT true,
  message_alerts    BOOLEAN NOT NULL DEFAULT true,
  moderation_alerts BOOLEAN NOT NULL DEFAULT true,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE notification.user_preferences IS 'Per-user notification preferences. Check before sending; never block domain flows.';

-- 2) Enums for notification records
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'notification' AND t.typname = 'notification_status') THEN
    CREATE TYPE notification.notification_status AS ENUM (
      'pending',
      'sent',
      'failed',
      'retrying'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE n.nspname = 'notification' AND t.typname = 'notification_channel') THEN
    CREATE TYPE notification.notification_channel AS ENUM (
      'email',
      'sms',
      'push'
    );
  END IF;
END $$;

-- 3) Notification records — every attempt stored; idempotent by event id or (user_id, event_type, created_at) in app
CREATE TABLE IF NOT EXISTS notification.notifications (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL,
  event_type         TEXT NOT NULL,
  channel            notification.notification_channel NOT NULL,
  status             notification.notification_status NOT NULL DEFAULT 'pending',
  payload            JSONB NOT NULL,
  attempt_count      INTEGER NOT NULL DEFAULT 0,
  last_attempt_at    TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE notification.notifications IS 'Every notification attempt. Update status after delivery/retry; optional notification.sent event for analytics.';
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notification.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notification.notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_pending_retrying ON notification.notifications(status) WHERE status IN ('pending', 'retrying');

-- updated_at trigger for user_preferences
CREATE OR REPLACE FUNCTION notification.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_user_preferences_updated ON notification.user_preferences;
CREATE TRIGGER tr_user_preferences_updated
  BEFORE UPDATE ON notification.user_preferences
  FOR EACH ROW EXECUTE PROCEDURE notification.set_updated_at();
