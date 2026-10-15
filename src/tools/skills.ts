import type { Database } from "bun:sqlite";
import * as z from "zod/v4";
import { browseSkill, previousBrowseBody } from "./browse-skill.ts";
import { loadEccSkills } from "./ecc-skills.ts";
import { olderPlanBody, planSkill, previousPlanBody } from "./plan-skill.ts";
import { findRepoSkill, isProjectError, loadRepoSkills, resolveProjectPath } from "./repo-skills.ts";
import { fail, ok, type ToolResult } from "./result.ts";
import { isValidName } from "./names.ts";

const SKILL_BODY_LIMIT = 32_000;
const SKILL_DESCRIPTION_LIMIT = 200;
const SKILL_ROW_LIMIT = 200;

const projectPath = z.string().optional();

export const skillListInput = z.object({ project_path: projectPath });
export const skillReadInput = z.object({
  name: z.string(),
  project_path: projectPath,
  source: z.enum(["database", "repo"]).optional(),
});
export const skillDeleteInput = z.object({ name: z.string(), project_path: projectPath });
export const skillSaveInput = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
  project_path: projectPath,
});

type SkillListRow = { name: string; description: string; updated_at: string };
type SkillRow = SkillListRow & { body: string };
type BuiltInSkill = { name: string; description: string; body: string };

export function seedBuiltInSkills(db: Database): void {
  seedBuiltIn(db, planSkill, [previousPlanBody, olderPlanBody]);
  seedBuiltIn(db, browseSkill, previousBrowseBody);
  for (const skill of loadEccSkills()) seedBuiltIn(db, skill, null);
}

function seedBuiltIn(db: Database, skill: BuiltInSkill, previousBody: string | readonly string[] | null): void {
  if (
    skill.description.length < 1 ||
    skill.description.length > SKILL_DESCRIPTION_LIMIT ||
    skill.description.includes("\n") ||
    skill.description.includes("\r")
  ) {
    throw new Error(`${skill.name}_description_invalid`);
  }
  if (skill.body.length < 1 || skill.body.length > SKILL_BODY_LIMIT) {
    throw new Error(`${skill.name}_body_invalid`);
  }
  const now = new Date().toISOString();
  const inserted = db
    .query(
      `INSERT INTO skills (id, name, description, body, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO NOTHING`,
    )
    .run(crypto.randomUUID(), skill.name, skill.description, skill.body, now, now);
  if (inserted.changes === 1 || previousBody === null) return;
  const previousBodies = typeof previousBody === "string" ? [previousBody] : previousBody;
  for (const previous of previousBodies) {
    if (previous === skill.body) return;
    const updated = db
      .query(
        `UPDATE skills
         SET description = ?, body = ?, updated_at = ?
         WHERE name = ? AND body = ?`,
      )
      .run(skill.description, skill.body, now, skill.name, previous);
    if (updated.changes === 1) return;
  }
}

export function skillList(db: Database, input: z.infer<typeof skillListInput> = {}): ToolResult {
  const project = resolveProjectPath(input.project_path);
  if (isProjectError(project)) return project;
  const rows = db
    .query("SELECT name, description, updated_at FROM skills ORDER BY name ASC")
    .all() as SkillListRow[];
  if (!project) return ok(rows.map((row) => `${row.name}\t${row.updated_at}\t${row.description}`).join("\n"));
  const lines = [
    ...rows.map((row) => `${row.name}\tdatabase\t${row.updated_at}\t${row.description}`),
    ...loadRepoSkills(project).map((row) => `${row.name}\trepo\t\t${row.description}`),
  ];
  lines.sort((a, b) => a.localeCompare(b));
  return ok(lines.join("\n"));
}

export function skillRead(db: Database, input: z.infer<typeof skillReadInput>): ToolResult {
  if (!isValidName(input.name)) return fail("invalid_name", "name must be lowercase letters, numbers, and hyphens");
  if (input.source === "repo") {
    const project = resolveProjectPath(input.project_path);
    if (isProjectError(project)) return project;
    if (!project) return fail("project_path_required", "project_path is required to read a repo skill");
    const skill = findRepoSkill(project, input.name);
    if (!skill) return fail("not_found", "skill was not found");
    return ok(skill.body);
  }
  const row = db.query("SELECT name, description, body, updated_at FROM skills WHERE name = ?").get(input.name) as
    | SkillRow
    | null;
  if (!row) return fail("not_found", "skill was not found");
  return ok(row.body);
}

export function skillSave(db: Database, input: z.infer<typeof skillSaveInput>): ToolResult {
  if (!isValidName(input.name)) return fail("invalid_name", "name must be lowercase letters, numbers, and hyphens");
  const readonly = repoReadonly(input.project_path, input.name);
  if (readonly) return readonly;
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
  const readonly = repoReadonly(input.project_path, input.name);
  if (readonly) return readonly;
  const result = db.query("DELETE FROM skills WHERE name = ?").run(input.name);
  if (result.changes === 0) return fail("not_found", "skill was not found");
  return ok(`deleted ${input.name}`);
}

function repoReadonly(projectPath: string | undefined, name: string): ToolResult | undefined {
  const project = resolveProjectPath(projectPath);
  if (isProjectError(project)) return project;
  if (project && findRepoSkill(project, name)) return fail("repo_skill_readonly", "repo skills are read-only");
  return undefined;
}
