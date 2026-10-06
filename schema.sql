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

-- Escalations: guest questions that needed a human
CREATE TABLE IF NOT EXISTS escalations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT DEFAULT (datetime('now')),
  property_id TEXT REFERENCES properties(id),
  guest_number TEXT NOT NULL,
  question TEXT NOT NULL,
  status TEXT DEFAULT 'open',         -- 'open' | 'answered' | 'timeout'
  host_number TEXT,
  answered_at TEXT,
  answer_body TEXT
);

CREATE INDEX IF NOT EXISTS idx_esc_open ON escalations(host_number, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_esc_prop ON escalations(property_id, created_at DESC);

-- Leads: for email capture on the marketing site
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);