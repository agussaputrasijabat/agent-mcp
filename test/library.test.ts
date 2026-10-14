import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { memoryForget, memorySave, memorySearch } from "../src/tools/memory.ts";
import { browseSkill } from "../src/tools/browse-skill.ts";
import { planSkill, previousPlanBody } from "../src/tools/plan-skill.ts";
import { skillDelete, skillList, skillRead, skillSave } from "../src/tools/skills.ts";
import { openDatabase } from "../src/db/database.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fileDatabase() {
  const directory = mkdtempSync(join(tmpdir(), "agent-mcp-"));
  directories.push(directory);
  return join(directory, "agent.sqlite");
}

test("memory survives a restart and keeps project notes apart", () => {
  const path = fileDatabase();
  const first = openDatabase(path);
  expect(memorySave(first, { key: "tabs", body: "two spaces" }).isError).toBeUndefined();
  expect(memorySave(first, { key: "app-note", body: "local", project_path: "/work/app" }).isError).toBeUndefined();
  first.close();

  const second = openDatabase(path);
  const global = memorySearch(second, { query: "tabs" });
  expect(global.content[0].text).toContain("two spaces");
  const other = memorySearch(second, { query: "local", project_path: "/work/other" });
  expect(other.content[0].text).not.toContain("app-note");
  const same = memorySearch(second, { query: "local", project_path: "/work/app" });
  expect(same.content[0].text).toContain("app-note");
  expect(memorySearch(second, { query: "%" }).content[0].text).toBe("");
  memorySave(second, { key: "percent", body: "100% done" });
  expect(memorySearch(second, { query: "%" }).content[0].text).toContain("percent");
  expect(memorySave(second, { key: "Bad_Key", body: "no" }).content[0].text.startsWith("error invalid_key:")).toBe(true);
  expect(memoryForget(second, { key: "missing" }).content[0].text.startsWith("error not_found:")).toBe(true);
  second.close();
});

test("skills list descriptions, replace bodies, and delete", () => {
  const db = openDatabase(fileDatabase());
  expect(skillSave(db, { name: "review", description: "Read the diff first", body: "Always read the diff." }).isError).toBeUndefined();
  const listed = skillList(db);
  expect(listed.content[0].text).toContain("Read the diff first");
  expect(listed.content[0].text).not.toContain("Always read the diff.");
  expect(skillRead(db, { name: "review" }).content[0].text).toBe("Always read the diff.");
  skillSave(db, { name: "review", description: "Read the diff first", body: "Read it twice." });
  expect(skillRead(db, { name: "review" }).content[0].text).toBe("Read it twice.");
  expect(skillRead(db, { name: "missing" }).content[0].text.startsWith("error not_found:")).toBe(true);
  expect(skillDelete(db, { name: "review" }).isError).toBeUndefined();
  expect(skillRead(db, { name: "review" }).content[0].text.startsWith("error not_found:")).toBe(true);
  for (let index = 0; index < 200; index += 1) {
    skillSave(db, { name: `skill-${index}`, description: "extra", body: "body" });
  }
  expect(skillSave(db, { name: "one-more", description: "extra", body: "body" }).content[0].text.startsWith("error skill_limit:")).toBe(true);
  db.close();
});

test("fresh database includes plan and keeps a saved plan", () => {
  const path = fileDatabase();
  const first = openDatabase(path);
  const listed = skillList(first).content[0].text;
  const line = listed.split("\n").find((row) => row.startsWith("plan\t"));
  expect(line).toBeDefined();
  expect(line).toContain(planSkill.description);
  expect(planSkill.description.length).toBeGreaterThanOrEqual(1);
  expect(planSkill.description.length).toBeLessThanOrEqual(200);
  expect(planSkill.description.includes("\n")).toBe(false);
  expect(planSkill.body.length).toBeLessThanOrEqual(32_000);
  const body = skillRead(first, { name: "plan" }).content[0].text;
  expect(body).toBe(planSkill.body);
  expect(body).toContain("Implementasikan");
  expect(body).toContain("Revisi");
  expect(body).toContain("Batal");
  expect(body).not.toContain("Balas GO untuk mulai");

  const customBody = "Rencana kustom yang tidak boleh ditimpa.";
  expect(skillSave(first, { name: "plan", description: "Catatan lokal", body: customBody }).isError).toBeUndefined();
  const saved = first.query("SELECT description, body, updated_at FROM skills WHERE name = ?").get("plan") as {
    description: string;
    body: string;
    updated_at: string;
  };
  first.close();

  const second = openDatabase(path);
  const again = second.query("SELECT description, body, updated_at FROM skills WHERE name = ?").get("plan") as {
    description: string;
    body: string;
    updated_at: string;
  };
  expect(again).toEqual(saved);
  const listedAgain = skillList(second).content[0].text.split("\n").find((row) => row.startsWith("plan\t"));
  expect(listedAgain).toContain("Catatan lokal");
  expect(listedAgain).not.toContain(planSkill.body);
  expect(skillRead(second, { name: "plan" }).content[0].text).toBe(customBody);
  second.close();
});

test("previous built-in plan upgrades and a custom body survives", () => {
  const path = fileDatabase();
  const first = openDatabase(path);
  first
    .query("UPDATE skills SET description = ?, body = ?, updated_at = ? WHERE name = ?")
    .run("Pakai saat pengguna minta rencana sebelum kerja dimulai.", previousPlanBody, "2020-01-01T00:00:00.000Z", "plan");
  first.close();

  const second = openDatabase(path);
  const upgraded = second.query("SELECT description, body FROM skills WHERE name = ?").get("plan") as {
    description: string;
    body: string;
  };
  expect(previousPlanBody).toContain("Balas GO untuk mulai");
  expect(previousPlanBody).not.toBe(planSkill.body);
  expect(upgraded.description).toBe(planSkill.description);
  expect(upgraded.body).toBe(planSkill.body);
  expect(upgraded.body).toContain("Implementasikan");
  expect(upgraded.body).toContain("Revisi");
  expect(upgraded.body).toContain("Batal");
  expect(upgraded.body).not.toContain("Balas GO untuk mulai");

  const customBody = "Rencana kustom yang tidak boleh ditimpa.";
  expect(skillSave(second, { name: "plan", description: "Catatan lokal", body: customBody }).isError).toBeUndefined();
  const saved = second.query("SELECT description, body, updated_at FROM skills WHERE name = ?").get("plan") as {
    description: string;
    body: string;
    updated_at: string;
  };
  second.close();

  const third = openDatabase(path);
  expect(third.query("SELECT description, body, updated_at FROM skills WHERE name = ?").get("plan")).toEqual(saved);
  expect(skillRead(third, { name: "plan" }).content[0].text).toBe(customBody);
  third.close();
});

test("fresh database includes browse and keeps a custom browse", () => {
  const path = fileDatabase();
  const first = openDatabase(path);
  const listed = skillList(first).content[0].text;
  const line = listed.split("\n").find((row) => row.startsWith("browse\t"));
  expect(line).toBeDefined();
  expect(line).toContain(browseSkill.description);
  expect(browseSkill.description.length).toBeGreaterThanOrEqual(1);
  expect(browseSkill.description.length).toBeLessThanOrEqual(200);
  expect(browseSkill.description.includes("\n")).toBe(false);
  expect(skillRead(first, { name: "browse" }).content[0].text).toBe(browseSkill.body);
  expect(browseSkill.body).toContain("npm install -g browse");
  expect(browseSkill.body).toContain("--local");

  const customBody = "Browse kustom yang tidak boleh ditimpa.";
  expect(skillSave(first, { name: "browse", description: "Catatan browse", body: customBody }).isError).toBeUndefined();
  const saved = first.query("SELECT description, body, updated_at FROM skills WHERE name = ?").get("browse") as {
    description: string;
    body: string;
    updated_at: string;
  };
  first.close();

  const second = openDatabase(path);
  expect(second.query("SELECT description, body, updated_at FROM skills WHERE name = ?").get("browse")).toEqual(saved);
  expect(skillRead(second, { name: "browse" }).content[0].text).toBe(customBody);
  second.close();
});

test("repo skills are read-only and higher priority folders win", () => {
  const project = mkdtempSync(join(tmpdir(), "agent-mcp-repo-"));
  const outside = mkdtempSync(join(tmpdir(), "agent-mcp-outside-"));
  directories.push(project, outside);
  writeSkillDir(project, ".agents/skills", "review", "AGENTS_REVIEW", "Review from agents");
  writeSkillDir(project, ".claude/skills", "review", "CLAUDE_REVIEW", "Review from claude");
  writeSkillDir(project, ".claude/skills", "lint", "LINT_CLAUDE", "Lint from claude");
  writeSkillDir(project, ".codex/skills", "deploy", "CODEX_DEPLOY", "Deploy from codex");
  writeSkillDir(project, ".codex/skills", "audit", "CODEX_AUDIT", "Audit from codex");
  mkdirSync(join(project, ".opencode/commands"), { recursive: true });
  writeFileSync(
    join(project, ".opencode/commands/ship.md"),
    "---\nname: not-ship\ndescription: Ship the release\n---\nSHIP_ONLY\n",
  );
  writeFileSync(
    join(project, ".opencode/commands/deploy.md"),
    "---\ndescription: Deploy the app\n---\nOPENCODE_DEPLOY\n",
  );
  mkdirSync(join(outside, "hidden"), { recursive: true });
  writeFileSync(join(outside, "hidden/SKILL.md"), "OUTSIDE_SECRET\n");
  writeFileSync(join(outside, "leak.md"), "LEAK_SECRET\n");
  symlinkSync(join(outside, "hidden"), join(project, ".agents/skills/hidden"));
  symlinkSync(join(outside, "leak.md"), join(project, ".opencode/commands/leak.md"));

  const db = openDatabase(fileDatabase());
  expect(skillSave(db, { name: "ship", description: "Catatan db", body: "DB_SHIP" }).isError).toBeUndefined();
  const listed = skillList(db, { project_path: project }).content[0].text;
  const lines = listed.split("\n");
  expect(lines.filter((row) => row.startsWith("review\trepo\t"))).toEqual(["review\trepo\t\tReview from agents"]);
  expect(lines.filter((row) => row.startsWith("ship\trepo\t"))).toEqual(["ship\trepo\t\tShip the release"]);
  expect(lines.filter((row) => row.startsWith("deploy\trepo\t"))).toEqual(["deploy\trepo\t\tDeploy the app"]);
  expect(lines.some((row) => row.startsWith("lint\trepo\t"))).toBe(true);
  expect(lines.some((row) => row.startsWith("audit\trepo\t"))).toBe(true);
  expect(lines.some((row) => row.startsWith("not-ship\t"))).toBe(false);
  expect(lines.some((row) => row.startsWith("hidden\t"))).toBe(false);
  expect(lines.some((row) => row.startsWith("leak\t"))).toBe(false);
  expect(listed).not.toContain("OUTSIDE_SECRET");
  expect(listed).not.toContain("LEAK_SECRET");
  expect(lines.filter((row) => row.startsWith("ship\tdatabase\t"))).toHaveLength(1);
  expect(skillList(db).content[0].text).not.toContain("review\t");

  const agentsReview = skillRead(db, { name: "review", project_path: project, source: "repo" }).content[0].text;
  expect(agentsReview).toContain("AGENTS_REVIEW");
  expect(agentsReview).not.toContain("CLAUDE_REVIEW");
  const deploy = skillRead(db, { name: "deploy", project_path: project, source: "repo" }).content[0].text;
  expect(deploy).toContain("OPENCODE_DEPLOY");
  expect(deploy).not.toContain("CODEX_DEPLOY");
  expect(skillRead(db, { name: "ship", project_path: project, source: "repo" }).content[0].text).toContain("SHIP_ONLY");
  expect(skillRead(db, { name: "ship" }).content[0].text).toBe("DB_SHIP");
  expect(skillRead(db, { name: "review" }).content[0].text.startsWith("error not_found:")).toBe(true);
  expect(skillRead(db, { name: "hidden", project_path: project, source: "repo" }).content[0].text.startsWith("error not_found:")).toBe(true);

  const readonly = "error repo_skill_readonly: repo skills are read-only";
  const shipFile = join(project, ".opencode/commands/ship.md");
  const reviewFile = join(project, ".agents/skills/review/SKILL.md");
  expect(skillSave(db, { name: "ship", description: "ubah", body: "baru", project_path: project }).content[0].text).toBe(readonly);
  expect(skillDelete(db, { name: "ship", project_path: project }).content[0].text).toBe(readonly);
  expect(skillRead(db, { name: "ship" }).content[0].text).toBe("DB_SHIP");
  expect(readFileSync(shipFile, "utf8")).toContain("SHIP_ONLY");
  expect(existsSync(shipFile)).toBe(true);
  expect(skillSave(db, { name: "review", description: "ubah", body: "baru", project_path: project }).content[0].text).toBe(readonly);
  expect(skillDelete(db, { name: "review", project_path: project }).content[0].text).toBe(readonly);
  expect(readFileSync(reviewFile, "utf8")).toContain("AGENTS_REVIEW");
  expect(readFileSync(join(project, ".claude/skills/review/SKILL.md"), "utf8")).toContain("CLAUDE_REVIEW");
  expect(skillRead(db, { name: "review" }).content[0].text.startsWith("error not_found:")).toBe(true);

  expect(skillSave(db, { name: "local-note", description: "db skill", body: "note", project_path: project }).isError).toBeUndefined();
  expect(skillRead(db, { name: "local-note" }).content[0].text).toBe("note");
  expect(skillDelete(db, { name: "local-note", project_path: project }).isError).toBeUndefined();
  expect(skillRead(db, { name: "local-note" }).content[0].text.startsWith("error not_found:")).toBe(true);
  expect(skillList(db, { project_path: "relative/project" }).content[0].text.startsWith("error path_not_absolute:")).toBe(true);
  db.close();
});

function writeSkillDir(root: string, folder: string, name: string, body: string, description: string) {
  const directory = join(root, folder, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${description}\n---\n${body}\n`);
}
