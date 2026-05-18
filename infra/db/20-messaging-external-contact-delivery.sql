-- Delivery metadata for external email/SMS sent from OCH (history row created after successful send).
ALTER TABLE messages.external_contacts
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_error TEXT,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

COMMENT ON COLUMN messages.external_contacts.sent_at IS 'When the external provider accepted the message (SMTP/SMS).';
COMMENT ON COLUMN messages.external_contacts.delivery_error IS 'Provider error text when send fails before history insert.';
COMMENT ON COLUMN messages.external_contacts.provider_message_id IS 'Upstream id when available (e.g. Twilio SID, Message-Id).';
