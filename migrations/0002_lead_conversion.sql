ALTER TABLE admin_lead_progress RENAME TO admin_lead_progress_v1;

CREATE TABLE admin_lead_progress (
  email TEXT PRIMARY KEY,
  lead_status TEXT NOT NULL CHECK (lead_status IN ('new', 'contacted', 'interested', 'closed', 'converted')),
  checklist_json TEXT NOT NULL DEFAULT '{}',
  property_id TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO admin_lead_progress (email, lead_status, checklist_json, updated_at)
SELECT email, lead_status, checklist_json, updated_at FROM admin_lead_progress_v1;

DROP TABLE admin_lead_progress_v1;

CREATE TABLE admin_deleted_leads (
  email TEXT PRIMARY KEY,
  deleted_at TEXT NOT NULL DEFAULT (datetime('now'))
);
