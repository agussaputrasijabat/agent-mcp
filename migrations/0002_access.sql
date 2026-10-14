CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_base_url TEXT NOT NULL,
  shell_concurrency_limit INTEGER NOT NULL,
  shell_timeout_ms INTEGER NOT NULL,
  shell_timeout_max_ms INTEGER NOT NULL,
  output_char_limit INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
