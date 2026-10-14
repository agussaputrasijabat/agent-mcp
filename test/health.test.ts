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

test("migrations apply twice and enable WAL", () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-mcp-"));
  directories.push(directory);
  const databasePath = join(directory, "agent.sqlite");

  const first = openDatabase(databasePath);
  first.close();
  const second = openDatabase(databasePath);
  const mode = second.query("PRAGMA journal_mode").get() as { journal_mode: string };
  const migrations = second.query("SELECT COUNT(*) AS count FROM schema_migrations").get() as {
    count: number;
  };

  expect(mode.journal_mode).toBe("wal");
  expect(migrations.count).toBe(4);
  second.close();
});
