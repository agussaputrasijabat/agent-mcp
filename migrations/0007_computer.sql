CREATE TABLE IF NOT EXISTS computer_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  driver_observe INTEGER NOT NULL DEFAULT 0,
  driver_control INTEGER NOT NULL DEFAULT 0,
  sandbox_observe INTEGER NOT NULL DEFAULT 0,
  sandbox_manage INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO computer_settings (id, updated_at) VALUES (1, datetime('now'));

CREATE TABLE IF NOT EXISTS computer_sandbox_owners (
  name TEXT PRIMARY KEY,
  auth_kind TEXT NOT NULL,
  auth_subject TEXT NOT NULL,
  created_at TEXT NOT NULL
);
