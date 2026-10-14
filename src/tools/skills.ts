import type { Database } from "bun:sqlite";
import * as z from "zod/v4";
import { fail, ok, type ToolResult } from "./result.ts";
import { isValidName } from "./names.ts";

const SKILL_BODY_LIMIT = 32_000;
const SKILL_DESCRIPTION_LIMIT = 200;
const SKILL_ROW_LIMIT = 200;

export const skillReadInput = z.object({ name: z.string() });
export const skillDeleteInput = z.object({ name: z.string() });
export const skillSaveInput = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
});

type SkillListRow = { name: string; description: string; updated_at: string };
type SkillRow = SkillListRow & { body: string };

export function skillList(db: Database): ToolResult {
  const rows = db
    .query("SELECT name, description, updated_at FROM skills ORDER BY name ASC")
    .all() as SkillListRow[];
  return ok(rows.map((row) => `${row.name}\t${row.updated_at}\t${row.description}`).join("\n"));
}

export function skillRead(db: Database, input: z.infer<typeof skillReadInput>): ToolResult {
  if (!isValidName(input.name)) return fail("invalid_name", "name must be lowercase letters, numbers, and hyphens");
  const row = db.query("SELECT name, description, body, updated_at FROM skills WHERE name = ?").get(input.name) as
    | SkillRow
    | null;
  if (!row) return fail("not_found", "skill was not found");
  return ok(row.body);
}

export function skillSave(db: Database, input: z.infer<typeof skillSaveInput>): ToolResult {
  if (!isValidName(input.name)) return fail("invalid_name", "name must be lowercase letters, numbers, and hyphens");
  if (input.description.length < 1 || input.description.length > SKILL_DESCRIPTION_LIMIT) {
    return fail("validation_error", `description must be 1 to ${SKILL_DESCRIPTION_LIMIT} characters`);
  }
  if (input.body.length < 1 || input.body.length > SKILL_BODY_LIMIT) {
    return fail("body_too_large", `body must be 1 to ${SKILL_BODY_LIMIT} characters`);
  }
  const existing = db.query("SELECT id FROM skills WHERE name = ?").get(input.name) as { id: string } | null;
  if (!existing) {
    const count = db.query("SELECT COUNT(*) AS count FROM skills").get() as { count: number };
    if (count.count >= SKILL_ROW_LIMIT) return fail("skill_limit", `skills are limited to ${SKILL_ROW_LIMIT}`);
  }
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO skills (id, name, description, body, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       description = excluded.description,
       body = excluded.body,
       updated_at = excluded.updated_at`,
  ).run(existing?.id ?? crypto.randomUUID(), input.name, input.description, input.body, now, now);
  return ok(`saved ${input.name}`);
}

export function skillDelete(db: Database, input: z.infer<typeof skillDeleteInput>): ToolResult {
  if (!isValidName(input.name)) return fail("invalid_name", "name must be lowercase letters, numbers, and hyphens");
  const result = db.query("DELETE FROM skills WHERE name = ?").run(input.name);
  if (result.changes === 0) return fail("not_found", "skill was not found");
  return ok(`deleted ${input.name}`);
}
