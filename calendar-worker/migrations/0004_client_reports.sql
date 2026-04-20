-- Client-level reporting metadata for mentor follow-up workflows
CREATE TABLE IF NOT EXISTS client_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  client_ref TEXT NOT NULL,
  client_email TEXT,
  client_name TEXT,
  meeting_quality INTEGER,
  critical_note TEXT,
  reminder_sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_email, client_ref)
);

CREATE INDEX IF NOT EXISTS idx_client_reports_user ON client_reports(user_email);
CREATE INDEX IF NOT EXISTS idx_client_reports_ref ON client_reports(user_email, client_ref);