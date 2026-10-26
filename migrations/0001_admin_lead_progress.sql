CREATE TABLE IF NOT EXISTS admin_lead_progress (
  email TEXT PRIMARY KEY,
  lead_status TEXT NOT NULL CHECK (lead_status IN ('new', 'contacted', 'interested', 'closed')),
  checklist_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
