import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { resourceNames, resourceText } from "../resources.ts";
import { Database } from "bun:sqlite";
import { seedBuiltInSkills } from "../tools/skills.ts";

export function openDatabase(databasePath: string): Database {
  if (databasePath !== ":memory:") {
    try {
      mkdirSync(dirname(databasePath), { recursive: true });
    } catch (error) {
      const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: string }).code : undefined;
      if (code === "EROFS" || code === "EACCES") {
        console.error(JSON.stringify({ level: "error", msg: "database_path_not_writable", path: databasePath }));
        throw new Error("database_path_not_writable");
      }
      throw error;
    }
  }

  const db = new Database(databasePath, { create: true });
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=NORMAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec("PRAGMA busy_timeout=5000;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  applyMigrations(db);
  seedBuiltInSkills(db);
  return db;
}

function applyMigrations(db: Database): void {
  const files = resourceNames("migrations/").filter((file) => file.endsWith(".sql")).sort();
  const applied = db.query("SELECT id FROM schema_migrations").all() as { id: string }[];
  const appliedIds = new Set(applied.map((row) => row.id));

  const insert = db.query("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)");
  for (const file of files) {
    const migrationId = file.slice("migrations/".length);
    if (appliedIds.has(migrationId) || appliedIds.has(file)) continue;
    db.exec(resourceText(file));
    insert.run(migrationId, new Date().toISOString());
  }
}
