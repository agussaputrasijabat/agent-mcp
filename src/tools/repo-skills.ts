import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { isValidName, normalizeProjectPath } from "./names.ts";
import { codeFromErrno } from "./paths.ts";
import { fail, type ToolResult } from "./result.ts";

const MAX_SKILL_BYTES = 1_000_000;

const ROOTS = [
  { dir: ".agents/skills", kind: "skills" },
  { dir: ".claude/skills", kind: "skills" },
  { dir: ".opencode/commands", kind: "commands" },
  { dir: ".codex/skills", kind: "skills" },
] as const;

export type RepoSkill = {
  name: string;
  description: string;
  body: string;
};

export function resolveProjectPath(path: string | undefined): string | null | ToolResult {
  if (path === undefined) return null;
  if (!isAbsolute(path)) return fail("path_not_absolute", "project_path must be an absolute path");
  try {
    const real = realpathSync(normalizeProjectPath(path));
    if (!statSync(real).isDirectory()) return fail("not_found", "project_path is not a directory");
    return real;
  } catch (error) {
    return codeFromErrno(error);
  }
}

export function isProjectError(value: string | null | ToolResult): value is ToolResult {
  return typeof value === "object" && value !== null;
}

export function loadRepoSkills(projectReal: string): RepoSkill[] {
  const found = new Map<string, RepoSkill>();
  for (const root of ROOTS) {
    const rootReal = containedReal(projectReal, join(projectReal, root.dir));
    if (!rootReal || !isDirectory(rootReal)) continue;
    if (root.kind === "skills") scanSkillDirectories(rootReal, found);
    else scanCommandFiles(rootReal, found);
  }
  return [...found.values()];
}

export function findRepoSkill(projectReal: string, name: string): RepoSkill | null {
  return loadRepoSkills(projectReal).find((skill) => skill.name === name) ?? null;
}

function scanSkillDirectories(rootReal: string, found: Map<string, RepoSkill>): void {
  for (const entry of readNames(rootReal)) {
    const childReal = containedReal(rootReal, join(rootReal, entry));
    if (!childReal || !isDirectory(childReal)) continue;
    const fileReal = containedReal(rootReal, join(childReal, "SKILL.md"));
    if (!fileReal || !isFile(fileReal)) continue;
    const body = readUtf8(fileReal);
    if (body === null) continue;
    const front = parseFrontmatter(body);
    const name = front.name && isValidName(front.name) ? front.name : entry;
    if (!isValidName(name) || found.has(name)) continue;
    found.set(name, { name, description: oneLine(front.description ?? ""), body });
  }
}

function scanCommandFiles(rootReal: string, found: Map<string, RepoSkill>): void {
  for (const entry of readNames(rootReal)) {
    if (!entry.endsWith(".md")) continue;
    const name = entry.slice(0, -".md".length);
    if (!isValidName(name) || found.has(name)) continue;
    const fileReal = containedReal(rootReal, join(rootReal, entry));
    if (!fileReal || !isFile(fileReal)) continue;
    const body = readUtf8(fileReal);
    if (body === null) continue;
    const front = parseFrontmatter(body);
    found.set(name, { name, description: oneLine(front.description ?? ""), body });
  }
}

function readNames(directory: string): string[] {
  try {
    return readdirSync(directory)
      .filter((name) => name !== "." && name !== ".." && !name.includes("/") && !name.includes("\\"))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

function containedReal(rootReal: string, candidate: string): string | null {
  try {
    const real = realpathSync(candidate);
    if (!isInside(rootReal, real)) return null;
    return real;
  } catch {
    return null;
  }
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readUtf8(path: string): string | null {
  try {
    const bytes = readFileSync(path);
    if (bytes.byteLength > MAX_SKILL_BYTES) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function parseFrontmatter(text: string): { name?: string; description?: string } {
  const normalized = text.replaceAll("\r\n", "\n");
  if (!normalized.startsWith("---\n")) return {};
  const close = normalized.indexOf("\n---", 4);
  if (close === -1) return {};
  const result: { name?: string; description?: string } = {};
  for (const line of normalized.slice(4, close).split("\n")) {
    const match = /^(name|description):\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (!value) continue;
    if (match[1] === "name") result.name = value;
    else result.description = value;
  }
  return result;
}

function oneLine(value: string): string {
  return value.replaceAll("\t", " ").replaceAll("\r", " ").replaceAll("\n", " ").trim();
}
