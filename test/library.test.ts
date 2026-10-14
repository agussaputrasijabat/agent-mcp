import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { memoryForget, memorySave, memorySearch } from "../src/tools/memory.ts";
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
