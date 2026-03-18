-- Spam scoring for Trust service. Run after 01-trust-schema.sql.
-- Trust consumes MessageSentV1; applies detection rules; updates score. If threshold exceeded, emit UserSuspendedV1.
-- Messaging (and others) reject SendMessage for suspended users (check via gRPC or event).

CREATE TABLE IF NOT EXISTS trust.user_spam_score (
  user_id     UUID PRIMARY KEY,
  score       INTEGER NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE trust.user_spam_score IS 'Spam/abuse score from MessageSentV1 consumption. Rules: X msgs to different users in Y min, same content to many, frequency anomaly, user reports. If score exceeds threshold, Trust emits UserSuspendedV1.';
