-- External email/SMS contact logs (kept separate from in-app DM threads).
CREATE TABLE IF NOT EXISTS messages.external_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  contact_method TEXT NOT NULL CHECK (contact_method IN ('email', 'sms')),
  recipient_email TEXT NULL,
  recipient_phone TEXT NULL,
  subject TEXT NULL,
  body TEXT NOT NULL,
  listing_id UUID NULL,
  status TEXT NOT NULL DEFAULT 'logged',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_external_contacts_user_created
  ON messages.external_contacts (user_id, created_at DESC);
