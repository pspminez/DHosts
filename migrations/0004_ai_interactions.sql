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
