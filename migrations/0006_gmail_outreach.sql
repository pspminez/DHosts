CREATE TABLE IF NOT EXISTS email_suppressions (
  email_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS email_unsubscribe_tokens (
  token_hash TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  lead_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_email_unsubscribe_email
  ON email_unsubscribe_tokens(email_hash);

CREATE TABLE IF NOT EXISTS email_outreach_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id TEXT NOT NULL,
  recipient_hash TEXT NOT NULL,
  campaign_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'unknown')),
  provider_message_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  sent_at TEXT,
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+180 days')),
  UNIQUE (lead_id, recipient_hash, campaign_key)
);

CREATE INDEX IF NOT EXISTS idx_email_outreach_recent
  ON email_outreach_log(status, created_at DESC);
