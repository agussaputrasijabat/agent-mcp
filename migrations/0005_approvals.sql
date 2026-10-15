CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  reason TEXT NOT NULL,
  summary TEXT NOT NULL,
  arguments_hash TEXT NOT NULL,
  auth_kind TEXT NOT NULL,
  auth_subject TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  decided_at TEXT,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_approvals_status_expiry ON approvals (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_approvals_subject_hash ON approvals (auth_kind, auth_subject, arguments_hash);
