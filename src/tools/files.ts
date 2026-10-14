import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Dirent } from "node:fs";
import * as z from "zod/v4";
import {
  GLOB_MAX,
  GREP_MAX_DEPTH,
  GREP_MAX_FILES,
  GREP_MAX_MATCHES,
  WRITE_CHAR_LIMIT,
} from "../limits.ts";
import { codeFromErrno, requireAbsolute } from "./paths.ts";
import { imageMime, readImageFile } from "./image.ts";
import { fail, notice, ok, type ToolResult } from "./result.ts";

const skippedDirectories = new Set(["node_modules", ".git", "dist"]);

export const readFileInput = z.object({
  path: z.string(),
  offset: z.number().int().min(1).optional(),
  limit: z.number().int().min(1).max(2000).optional(),
});

export const writeFileInput = z.object({
  path: z.string(),
  contents: z.string(),
});

export const editFileInput = z.object({
  path: z.string(),
  old_string: z.string().min(1),
  new_string: z.string(),
});

export const globInput = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
});

export const grepInput = z.object({
  pattern: z.string().min(1),
  path: z.string().optional(),
  glob: z.string().optional(),
});

export function readFile(input: z.infer<typeof readFileInput>): ToolResult {
  const absolute = requireAbsolute(input.path);
  if (absolute) return absolute;
  try {
    const info = statSync(input.path);
    if (info.isDirectory()) return fail("is_directory", "path is a directory");
    if (imageMime(input.path)) return readImageFile(input.path);
    const decoded = decodeUtf8(readFileSync(input.path));
    if (typeof decoded !== "string") return decoded;
    const lines = decoded.split("\n");
    const start = (input.offset ?? 1) - 1;
    if (input.offset !== undefined && start >= lines.length) return ok("notice empty_range");
    const selected = input.limit === undefined ? lines.slice(start) : lines.slice(start, start + input.limit);
    return ok(selected.join("\n"));
  } catch (error) {
    return codeFromErrno(error);
  }
}

export function writeFile(input: z.infer<typeof writeFileInput>): ToolResult {
  const absolute = requireAbsolute(input.path);
  if (absolute) return absolute;
  if (input.contents.length > WRITE_CHAR_LIMIT) {
    return fail("body_too_large", `contents exceed ${WRITE_CHAR_LIMIT} characters`);
  }
  try {
    const info = statIfExists(input.path);
    if (info?.isDirectory()) return fail("is_directory", "path is a directory");
    mkdirSync(dirname(input.path), { recursive: true });
    writeFileSync(input.path, input.contents, "utf8");
    return ok(`wrote ${input.path}`);
  } catch (error) {
    return codeFromErrno(error);
  }
}

export function editFile(input: z.infer<typeof editFileInput>): ToolResult {
  const absolute = requireAbsolute(input.path);
  if (absolute) return absolute;
  if (input.old_string === input.new_string) return fail("edit_noop", "old_string and new_string are the same");
  try {
    const info = statSync(input.path);
    if (info.isDirectory()) return fail("is_directory", "path is a directory");
    const decoded = decodeUtf8(readFileSync(input.path));
    if (typeof decoded !== "string") return decoded;
    const matches = countOccurrences(decoded, input.old_string);
    if (matches === 0) return fail("edit_not_found", "old_string was not found");
    if (matches > 1) return fail("edit_not_unique", "old_string matched more than once");
    writeFileSync(input.path, decoded.replace(input.old_string, input.new_string), "utf8");
    return ok(`edited ${input.path}`);
  } catch (error) {
    return codeFromErrno(error);
  }
}

export function findFiles(input: z.infer<typeof globInput>): ToolResult {
  const root = input.path ?? process.cwd();
  if (input.path) {
    const absolute = requireAbsolute(input.path);
    if (absolute) return absolute;
  }
  try {
    if (!statSync(root).isDirectory()) return fail("not_found", "path is not a directory");
    const glob = new Bun.Glob(input.pattern);
    const matches: string[] = [];
    let capped = false;
    for (const file of glob.scanSync({ cwd: root, onlyFiles: true })) {
      if (matches.length >= GLOB_MAX) {
        capped = true;
        break;
      }
      matches.push(join(root, file));
    }
    return ok(capped ? notice(matches.join("\n"), "notice glob_capped") : matches.join("\n"));
  } catch (error) {
    return codeFromErrno(error);
  }
}

export function searchFiles(input: z.infer<typeof grepInput>): ToolResult {
  const root = input.path ?? process.cwd();
  if (input.path) {
    const absolute = requireAbsolute(input.path);
    if (absolute) return absolute;
  }
  let regex: RegExp;
  try {
    regex = new RegExp(input.pattern);
  } catch {
    return fail("invalid_regex", "pattern is not a valid regular expression");
  }
  const nameGlob = input.glob ? new Bun.Glob(input.glob) : undefined;
  const matches: string[] = [];
  let filesScanned = 0;
  let scanCapped = false;

  const considerFile = (full: string): void => {
    if (matches.length >= GREP_MAX_MATCHES || scanCapped) return;
    if (filesScanned >= GREP_MAX_FILES) {
      scanCapped = true;
      return;
    }
    filesScanned += 1;
    const decoded = decodeUtf8(readFileSync(full));
    if (typeof decoded !== "string") return;
    for (const [index, line] of decoded.split("\n").entries()) {
      regex.lastIndex = 0;
      if (!regex.test(line)) continue;
      matches.push(`${full}:${index + 1}:${line}`);
      if (matches.length >= GREP_MAX_MATCHES) return;
    }
  };

  const visit = (directory: string, depth: number): void => {
    if (scanCapped || matches.length >= GREP_MAX_MATCHES || depth > GREP_MAX_DEPTH) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      const result = codeFromErrno(error);
      if (result.content[0].text.startsWith("error eacces:")) throw error;
      return;
    }
    for (const entry of entries) {
      if (matches.length >= GREP_MAX_MATCHES) return;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (skippedDirectories.has(entry.name)) continue;
        visit(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (nameGlob && !nameGlob.match(entry.name)) continue;
      considerFile(full);
    }
  };

  try {
    const info = statSync(root);
    if (info.isDirectory()) visit(root, 1);
    else if (info.isFile()) considerFile(root);
    else return fail("not_found", "path does not exist");
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error) return codeFromErrno(error);
    return codeFromErrno(error);
  }

  let text = matches.join("\n");
  if (matches.length >= GREP_MAX_MATCHES) text = notice(text, "notice match_capped");
  if (scanCapped) text = notice(text, "notice scan_capped");
  return ok(text);
}

function decodeUtf8(bytes: Buffer): string | ToolResult {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return fail("not_utf8", "file is not valid UTF-8");
  }
}

function statIfExists(path: string) {
  try {
    return statSync(path);
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  let from = 0;
  while (from <= text.length) {
    const found = text.indexOf(needle, from);
    if (found === -1) return count;
    count += 1;
    from = found + needle.length;
  }
  return count;
}
