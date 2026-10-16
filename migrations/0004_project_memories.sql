CREATE TABLE IF NOT EXISTS project_memories (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  body TEXT NOT NULL,
  project_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_path, key)
);
CREATE INDEX IF NOT EXISTS idx_project_memories_updated ON project_memories (project_path, updated_at DESC);
