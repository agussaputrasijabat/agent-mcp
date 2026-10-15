import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { testApp } from "./harness.ts";
import { openDatabase } from "../src/db/database.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("GET /health returns ok", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-mcp-"));
  directories.push(directory);
  const db = openDatabase(join(directory, "agent.sqlite"));
  const app = await testApp(db);

  const response = await app.request("/health", { headers: { host: "127.0.0.1" } });
  const body = (await response.json()) as { data: { ok: boolean }; error: null };

  expect(response.status).toBe(200);
  expect(body).toEqual({ data: { ok: true }, error: null });
  db.close();
});

test("migrations apply twice and enable WAL with normal sync", () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-mcp-"));
  directories.push(directory);
  const databasePath = join(directory, "agent.sqlite");

  const first = openDatabase(databasePath);
  first.close();
  const second = openDatabase(databasePath);
  const mode = second.query("PRAGMA journal_mode").get() as { journal_mode: string };
  const sync = second.query("PRAGMA synchronous").get() as { synchronous: number };
  const migrations = second.query("SELECT COUNT(*) AS count FROM schema_migrations").get() as {
    count: number;
  };

  expect(mode.journal_mode).toBe("wal");
  expect(sync.synchronous).toBe(1);
  expect(migrations.count).toBe(7);
  const columns = second.query("PRAGMA table_info(settings)").all() as { name: string; dflt_value: string | null }[];
  expect(columns.find((column) => column.name === "shell_policy")?.dflt_value).toBe("'strict'");
  second.close();
});

test("SQLite rolls back DDL when the matching migration record cannot be inserted", () => {
  const db = openDatabase(":memory:");
  db.exec("CREATE TABLE migration_probe (id TEXT PRIMARY KEY); INSERT INTO migration_probe VALUES ('duplicate')");
  expect(() => db.transaction(() => {
    db.exec("ALTER TABLE migration_probe ADD COLUMN migrated INTEGER");
    db.query("INSERT INTO migration_probe (id) VALUES ('duplicate')").run();
  })()).toThrow();
  const columns = db.query("PRAGMA table_info(migration_probe)").all() as { name: string }[];
  expect(columns.some(({ name }) => name === "migrated")).toBe(false);
  db.close();
});

test("existing migrations retain legacy IDs after reopening", () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-mcp-migrations-"));
  directories.push(directory);
  const databasePath = join(directory, "agent.sqlite");

  const first = openDatabase(databasePath);
  first.exec("UPDATE schema_migrations SET id = substr(id, 12) WHERE id LIKE 'migrations/%'");
  const before = first.query("SELECT id FROM schema_migrations ORDER BY id").all() as { id: string }[];
  expect(before).toHaveLength(7);
  expect(before.every(({ id }) => !id.includes("/"))).toBe(true);
  first.close();

  const second = openDatabase(databasePath);
  const after = second.query("SELECT id FROM schema_migrations ORDER BY id").all() as { id: string }[];
  expect(after).toEqual(before);
  second.close();
});
