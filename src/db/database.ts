import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";

export function openDatabase(databasePath: string): Database {
  if (databasePath !== ":memory:") {
    mkdirSync(dirname(databasePath), { recursive: true });
  }

  const db = new Database(databasePath, { create: true });
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec("PRAGMA busy_timeout=5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  applyMigrations(db);
  return db;
}

function applyMigrations(db: Database): void {
  const directory = join(import.meta.dir, "../../migrations");
  const files = readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const applied = db.query("SELECT id FROM schema_migrations").all() as { id: string }[];
  const appliedIds = new Set(applied.map((row) => row.id));

  const insert = db.query("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");
  for (const file of files) {
    if (appliedIds.has(file)) continue;
    db.exec(readFileSync(join(directory, file), "utf8"));
    insert.run(file, new Date().toISOString());
  }
}
