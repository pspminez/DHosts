-- Keep pilots as real properties so incoming SMS can resolve and measure them.
ALTER TABLE properties ADD COLUMN stage TEXT NOT NULL DEFAULT 'live'
  CHECK (stage IN ('draft', 'pilot', 'live'));

CREATE INDEX IF NOT EXISTS idx_properties_stage ON properties(stage);

CREATE TABLE IF NOT EXISTS pilot_profiles (
  property_id TEXT PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  lead_id TEXT,
  client_name TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  location TEXT,
  started_at TEXT,
  ends_at TEXT,
  fee_cents INTEGER,
  status TEXT NOT NULL DEFAULT 'inactive'
  CHECK (status IN ('inactive', 'active')),
  checklist_json TEXT NOT NULL DEFAULT '{}',
  scorecard_json TEXT NOT NULL DEFAULT '{}',
  knowledge_json TEXT NOT NULL DEFAULT '{"answers":[],"secrets":[]}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pilot_profiles_lead ON pilot_profiles(lead_id);

-- Lead discovery answers share the admin lead row. Secrets and access details are
-- never stored in this field; the worker filters critical answers before saving.
ALTER TABLE admin_lead_progress ADD COLUMN knowledge_json TEXT NOT NULL DEFAULT '{"answers":[],"secrets":[]}';

CREATE TABLE IF NOT EXISTS admin_deleted_leads (
  lead_id TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
