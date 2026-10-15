import type { Database } from "bun:sqlite";
import { isAbsolute } from "node:path";
import * as z from "zod/v4";
import { fail, ok, type ToolResult } from "./result.ts";
import { isValidName, likeContains, normalizeProjectPath } from "./names.ts";

const MEMORY_BODY_LIMIT = 8_000;
const MEMORY_ROW_LIMIT = 1_000;
const SEARCH_LIMIT = 20;

export const memorySearchInput = z.object({
  query: z.string().min(1).max(200),
  project_path: z.string().optional(),
});

export const memorySaveInput = z.object({
  key: z.string(),
  body: z.string(),
  project_path: z.string().optional(),
});

export const memoryForgetInput = z.object({
  key: z.string(),
  project_path: z.string().optional(),
});

type MemoryRow = {
  key: string;
  body: string;
  project_path: string | null;
  updated_at: string;
};

export function memorySearch(db: Database, input: z.infer<typeof memorySearchInput>): ToolResult {
  const project = normalizeOptionalPath(input.project_path);
  if (typeof project !== "string" && project) return project;
  const pattern = likeContains(input.query);
  const rows = db.query(
    `SELECT key, body, project_path, updated_at FROM (
       SELECT key, body, project_path, updated_at FROM memories
         WHERE project_path IS NULL OR project_path = ?
       UNION ALL
       SELECT key, body, NULLIF(project_path, '') AS project_path, updated_at FROM project_memories
         WHERE project_path = '' OR project_path = ?
     ) WHERE key LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'
     ORDER BY updated_at DESC LIMIT ?`,
  ).all(project ?? "", project ?? "", pattern, pattern, SEARCH_LIMIT) as MemoryRow[];
  return ok(rows.map((row) => `${row.key}\t${row.project_path ?? ""}\t${row.updated_at}\n${row.body}`).join("\n\n"));
}

export function memorySave(db: Database, input: z.infer<typeof memorySaveInput>): ToolResult {
  if (!isValidName(input.key)) return fail("invalid_key", "key must be lowercase letters, numbers, and hyphens");
  if (input.body.length < 1 || input.body.length > MEMORY_BODY_LIMIT) {
    return fail("body_too_large", `body must be 1 to ${MEMORY_BODY_LIMIT} characters`);
  }
  const project = normalizeOptionalPath(input.project_path);
  if (typeof project !== "string" && project) return project;
  const legacy = db.query("SELECT id FROM memories WHERE key = ? AND project_path IS ?")
    .get(input.key, project) as { id: string } | null;
  const scope = project ?? "";
  const existing = db.query("SELECT id FROM project_memories WHERE project_path = ? AND key = ?")
    .get(scope, input.key) as { id: string } | null;
  if (!legacy && !existing) {
    const oldCount = (db.query("SELECT COUNT(*) AS count FROM memories").get() as { count: number }).count;
    const newCount = (db.query("SELECT COUNT(*) AS count FROM project_memories").get() as { count: number }).count;
    if (oldCount + newCount >= MEMORY_ROW_LIMIT) return fail("memory_limit", `memory is limited to ${MEMORY_ROW_LIMIT} notes`);
  }
  const now = new Date().toISOString();
  if (legacy && !existing) {
    db.query("UPDATE memories SET body = ?, updated_at = ? WHERE id = ?").run(input.body, now, legacy.id);
  } else {
    db.query(
      `INSERT INTO project_memories (id, key, body, project_path, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_path, key) DO UPDATE SET
         body = excluded.body, updated_at = excluded.updated_at`,
    ).run(existing?.id ?? crypto.randomUUID(), input.key, input.body, scope, now, now);
  }
  return ok(`saved ${input.key}`);
}

export function memoryForget(db: Database, input: z.infer<typeof memoryForgetInput>): ToolResult {
  if (!isValidName(input.key)) return fail("invalid_key", "key must be lowercase letters, numbers, and hyphens");
  const project = normalizeOptionalPath(input.project_path);
  if (typeof project !== "string" && project) return project;
  const legacy = db.query("DELETE FROM memories WHERE key = ? AND project_path IS ?").run(input.key, project);
  const current = db.query("DELETE FROM project_memories WHERE key = ? AND project_path = ?")
    .run(input.key, project ?? "");
  if (legacy.changes + current.changes === 0) return fail("not_found", "memory was not found");
  return ok(`deleted ${input.key}`);
}

function normalizeOptionalPath(path: string | undefined): string | null | ToolResult {
  if (path === undefined) return null;
  if (!isAbsolute(path)) return fail("path_not_absolute", "project_path must be an absolute path");
  return normalizeProjectPath(path);
}
