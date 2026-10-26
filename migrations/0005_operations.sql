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

INSERT OR IGNORE INTO property_escalation_rules (property_id, risk_level, enabled, destination)
SELECT id, 'low', 1, 'host' FROM properties;
INSERT OR IGNORE INTO property_escalation_rules (property_id, risk_level, enabled, destination)
SELECT id, 'high', 1, 'host' FROM properties;
INSERT OR IGNORE INTO property_escalation_rules (property_id, risk_level, enabled, destination)
SELECT id, 'emergency', 1, 'host' FROM properties;

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

CREATE INDEX IF NOT EXISTS idx_property_change_requests_pending
  ON property_change_requests(status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_property_created
  ON admin_audit_log(property_id, created_at DESC);

CREATE TABLE IF NOT EXISTS message_threads (
  thread_id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  guest_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL DEFAULT (datetime('now', '+180 days'))
);

ALTER TABLE messages ADD COLUMN thread_id TEXT;
ALTER TABLE messages ADD COLUMN expires_at TEXT;
ALTER TABLE escalations ADD COLUMN host_notified INTEGER;
ALTER TABLE escalations ADD COLUMN thread_id TEXT;
ALTER TABLE escalations ADD COLUMN expires_at TEXT;

UPDATE messages
SET expires_at = datetime(COALESCE(created_at, 'now'), '+180 days')
WHERE expires_at IS NULL;
UPDATE escalations
SET expires_at = datetime(COALESCE(created_at, 'now'), '+180 days')
WHERE expires_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_thread_created
  ON messages(thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_expires
  ON messages(expires_at);
CREATE INDEX IF NOT EXISTS idx_escalations_expires
  ON escalations(expires_at);
CREATE INDEX IF NOT EXISTS idx_escalations_host_notified
  ON escalations(host_notified, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_interactions_expires
  ON ai_interactions(expires_at);
