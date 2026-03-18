-- Optional DB-backed sliding window for messaging rate limit. Prefer Redis (rate:msg:{user_id}, INCR, EXPIRE 60s).
-- Use this only if Redis is not available. See docs/MESSAGING_RATE_LIMIT_AND_SPAM.md.
-- Run after 01-messaging-schema.sql. Messaging service must aggregate count per user per window and reject when > 30/min (or configured max).

CREATE TABLE IF NOT EXISTS messaging.message_rate_limit (
  user_id       UUID NOT NULL,
  window_start  TIMESTAMPTZ NOT NULL,
  count         INT NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, window_start)
);

CREATE INDEX IF NOT EXISTS idx_message_rate_limit_window ON messaging.message_rate_limit(window_start);

COMMENT ON TABLE messaging.message_rate_limit IS 'Optional sliding-window rate limit. Prefer Redis (rate:msg:{user_id}). Rule: max 30 messages per minute, 500 per day per user. Cleanup old windows periodically.';
