-- Davenport Host Co. — D1 schema
-- Run: wrangler d1 execute davenport --remote --file=./schema.sql

-- Hosts: the people who own/manage properties and receive escalations
CREATE TABLE IF NOT EXISTS hosts (
  id TEXT PRIMARY KEY,                -- e.g. "host_dana"
  name TEXT NOT NULL,
  phone TEXT UNIQUE NOT NULL,         -- E.164, the escalation target
  email TEXT,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Properties: each vacation home
CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,                -- house code, e.g. "SUNSET"
  house_code TEXT UNIQUE NOT NULL,    -- same as id, for clarity
  display_name TEXT,                  -- "Sunset Villa"
  address TEXT,
  host_id TEXT REFERENCES hosts(id),
  twilio_number TEXT,                 -- the guest-facing number (shared or per-property)
  active INTEGER DEFAULT 1,
  rate_limit_reply TEXT DEFAULT 'Let me get the host to help you with this.',
  unknown_reply TEXT DEFAULT 'Good question — let me check with your host and get right back to you.',
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Messages: append-only transcript for reporting and KB improvement
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  direction TEXT NOT NULL,            -- 'in' | 'out'
  property_id TEXT REFERENCES properties(id),
  from_number TEXT NOT NULL,          -- E.164
  body TEXT,                          -- original (may contain codes for outbound)
  body_redacted TEXT,                 -- safe for display/logs
  thread_id TEXT,
  expires_at TEXT DEFAULT (datetime('now', '+180 days')),
  intent_key TEXT,                    -- e.g. "gate", "wifi", "checkout"
  risk TEXT,                          -- 'low' | 'high' | 'emergency'
  resolution TEXT,                    -- 'keyword' | 'ai' | 'escalated' | 'unrouted' | 'blocked' | 'emergency'
  ai_model TEXT,                      -- e.g. 'claude-opus-5-5'
  tokens_in INTEGER,
  tokens_out INTEGER,
  cost_estimate REAL
);

CREATE INDEX IF NOT EXISTS idx_msg_created ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_res ON messages(resolution, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_prop ON messages(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_msg_from ON messages(from_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_expires ON messages(expires_at);

-- Redacted prompt/response audit for AI calls from the guest SMS flow
CREATE TABLE IF NOT EXISTS ai_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  property_id TEXT NOT NULL REFERENCES properties(id),
  house_code TEXT NOT NULL,
  thread_id TEXT,
  model TEXT NOT NULL,
  conversation_context TEXT NOT NULL,
  prompt TEXT NOT NULL,
  response TEXT,
  outcome TEXT NOT NULL,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  tokens_in INTEGER,
  tokens_out INTEGER,
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+180 days'))
);

CREATE INDEX IF NOT EXISTS idx_ai_interactions_property_created
  ON ai_interactions(property_id, created_at DESC);

-- Escalations: guest questions that needed a human
CREATE TABLE IF NOT EXISTS escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  property_id TEXT REFERENCES properties(id),
  guest_number TEXT NOT NULL,
  question TEXT NOT NULL,
  status TEXT DEFAULT 'open',         -- 'open' | 'answered' | 'timeout'
  host_number TEXT,
  host_notified INTEGER,
  thread_id TEXT,
  expires_at TEXT DEFAULT (datetime('now', '+180 days')),
  answered_at TEXT,
  answer_body TEXT
);

CREATE INDEX IF NOT EXISTS idx_esc_open ON escalations(host_number, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_esc_prop ON escalations(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_esc_thread ON escalations(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_escalations_expires ON escalations(expires_at);
CREATE INDEX IF NOT EXISTS idx_escalations_host_notified ON escalations(host_notified, created_at DESC);

CREATE TABLE IF NOT EXISTS property_metadata (
  property_id TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  checkin_time TEXT,
  checkout_time TEXT,
  wifi_ssid TEXT,
  access_instructions TEXT,
  emergency_contacts TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS property_policies (
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  policy_key TEXT NOT NULL,
  policy_value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (property_id, policy_key)
);

CREATE TABLE IF NOT EXISTS property_escalation_rules (
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'high', 'emergency')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  destination TEXT NOT NULL DEFAULT 'host',
  instructions TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (property_id, risk_level)
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  changed_fields_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS property_change_requests (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  kv_key TEXT NOT NULL,
  changed_fields_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  requested_by TEXT NOT NULL,
  reviewed_by TEXT,
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);

CREATE TABLE IF NOT EXISTS message_threads (
  thread_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  guest_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+180 days'))
);

-- Leads: for email capture on the marketing site
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Admin outreach progress for the static lead list
CREATE TABLE IF NOT EXISTS admin_lead_progress (
  lead_id TEXT PRIMARY KEY,
  lead_status TEXT NOT NULL CHECK (lead_status IN ('new', 'contacted', 'interested', 'closed', 'converted')),
  checklist_json TEXT NOT NULL DEFAULT '{}',
  property_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_deleted_leads (
  lead_id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Email outreach stores recipient hashes and delivery metadata, never message bodies.
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