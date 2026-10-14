CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  tool_name TEXT NOT NULL,
  arguments_json TEXT NOT NULL,
  result_text TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  client_name TEXT,
  client_version TEXT,
  auth_kind TEXT NOT NULL,
  auth_subject TEXT NOT NULL,
  session_key TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_started_at ON tool_calls (started_at);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session_started ON tool_calls (session_key, started_at);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name ON tool_calls (tool_name);
