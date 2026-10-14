import { closeSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import type { Dirent } from "node:fs";
import * as z from "zod/v4";
import {
  GLOB_MAX,
  GREP_MAX_DEPTH,
  GREP_MAX_FILES,
  GREP_MAX_MATCHES,
  OUTPUT_CHAR_LIMIT,
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
    if (input.offset === undefined && input.limit === undefined) return readCappedText(input.path);
    return readLineWindow(input.path, input.offset, input.limit);
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
    const allowsDot = patternAllowsDot(input.pattern);
    const matches: string[] = [];
    let capped = false;

    const visit = (directory: string): void => {
      if (capped) return;
      let entries: Dirent[];
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch (error) {
        const result = codeFromErrno(error);
        if (result.content[0].text.startsWith("error eacces:")) throw error;
        return;
      }
      for (const entry of entries) {
        if (capped) return;
        if (entry.isSymbolicLink()) continue;
        const full = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (skippedDirectories.has(entry.name)) continue;
          if (entry.name.startsWith(".") && !allowsDot) continue;
          visit(full);
          continue;
        }
        if (!entry.isFile()) continue;
        if (entry.name.startsWith(".") && !allowsDot) continue;
        const rel = relative(root, full).split(sep).join("/");
        if (!glob.match(rel)) continue;
        matches.push(full);
        if (matches.length >= GLOB_MAX) {
          capped = true;
          return;
        }
      }
    };

    visit(root);
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
    const start = matches.length;
    const status = scanTextLines(full, (line, lineNo) => {
      regex.lastIndex = 0;
      if (!regex.test(line)) return true;
      matches.push(`${full}:${lineNo}:${line}`);
      return matches.length < GREP_MAX_MATCHES;
    });
    if (status !== "ok") matches.length = start;
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

function patternAllowsDot(pattern: string): boolean {
  return /(^|\/|\{|,)\./.test(pattern);
}

function readCappedText(path: string): ToolResult {
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(65_536);
  let pending = Buffer.alloc(0);
  let text = "";
  try {
    while (text.length <= OUTPUT_CHAR_LIMIT) {
      const n = readSync(fd, buf, 0, buf.length, null);
      const eof = n === 0;
      if (!eof) pending = Buffer.concat([pending, buf.subarray(0, n)]);
      const cut = utf8Cut(pending, eof);
      text += cut.text;
      if (text.length > OUTPUT_CHAR_LIMIT) break;
      if (cut.error) return fail("not_utf8", "file is not valid UTF-8");
      pending = Buffer.from(pending.subarray(cut.consumed));
      if (eof) break;
    }
  } finally {
    closeSync(fd);
  }
  return ok(text);
}

function readLineWindow(path: string, offset: number | undefined, limit: number | undefined): ToolResult {
  const start = (offset ?? 1) - 1;
  const end = limit === undefined ? Number.POSITIVE_INFINITY : start + limit;
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(65_536);
  let pending = Buffer.alloc(0);
  let lineIndex = 0;
  let out = "";
  let started = false;
  let discard = false;
  try {
    const joined = (line: string): string => (started ? `${out}\n${line}` : line);
    const finish = (line: string): ToolResult | undefined => {
      const current = lineIndex;
      lineIndex += 1;
      if (current < start || current >= end) {
        if (lineIndex >= end) return ok(out);
        return undefined;
      }
      out = joined(line);
      started = true;
      if (out.length > OUTPUT_CHAR_LIMIT || lineIndex >= end) return ok(out);
      return undefined;
    };

    const pump = (eof: boolean): ToolResult | undefined => {
      while (true) {
        if (discard) {
          const newline = pending.indexOf(0x0a);
          if (newline === -1) {
            if (!eof) {
              pending = Buffer.alloc(0);
              return undefined;
            }
            lineIndex += 1;
            discard = false;
            if (offset !== undefined && start >= lineIndex) return ok("notice empty_range");
            return ok(out);
          }
          pending = Buffer.from(pending.subarray(newline + 1));
          lineIndex += 1;
          discard = false;
          continue;
        }
        const newline = pending.indexOf(0x0a);
        if (newline === -1) {
          if (!eof && lineIndex < start && pending.length > 1_048_576) {
            pending = Buffer.alloc(0);
            discard = true;
            return undefined;
          }
          const inWindow = lineIndex >= start && lineIndex < end;
          if (inWindow && pending.length > 0) {
            const cut = utf8Cut(pending, eof);
            const next = joined(cut.text);
            if (next.length > OUTPUT_CHAR_LIMIT) return ok(next);
            if (cut.error) return fail("not_utf8", "file is not valid UTF-8");
            if (eof) {
              const early = finish(cut.text);
              if (early) return early;
              if (offset !== undefined && start >= lineIndex) return ok("notice empty_range");
              return ok(out);
            }
            return undefined;
          }
          if (!eof) return undefined;
          if (pending.length === 0) {
            const early = finish("");
            if (early) return early;
          } else lineIndex += 1;
          if (offset !== undefined && start >= lineIndex) return ok("notice empty_range");
          return ok(out);
        }
        const lineBytes = pending.subarray(0, newline);
        pending = Buffer.from(pending.subarray(newline + 1));
        const current = lineIndex;
        if (current < start || current >= end) {
          lineIndex += 1;
          if (lineIndex >= end) return ok(out);
          continue;
        }
        const cut = utf8Cut(lineBytes, true);
        if (cut.error) {
          const next = joined(cut.text);
          if (next.length > OUTPUT_CHAR_LIMIT) return ok(next);
          return fail("not_utf8", "file is not valid UTF-8");
        }
        const early = finish(cut.text);
        if (early) return early;
      }
    };

    while (true) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      pending = Buffer.concat([pending, buf.subarray(0, n)]);
      const early = pump(false);
      if (early) return early;
    }
    return pump(true) ?? ok(out);
  } finally {
    closeSync(fd);
  }
}

function utf8Cut(bytes: Uint8Array, eof: boolean): { text: string; consumed: number; error: boolean } {
  let index = 0;
  while (index < bytes.length) {
    const lead = bytes[index] ?? 0;
    const width = utf8SequenceWidth(lead);
    if (width === 0) return utf8Piece(bytes, index, true);
    if (index + width > bytes.length) return utf8Piece(bytes, index, eof);
    if (!utf8SequenceOk(bytes, index, width)) return utf8Piece(bytes, index, true);
    index += width;
  }
  return utf8Piece(bytes, bytes.length, false);
}

function utf8Piece(bytes: Uint8Array, consumed: number, error: boolean): { text: string; consumed: number; error: boolean } {
  const text = consumed === 0 ? "" : new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, consumed));
  return { text, consumed, error };
}

function utf8SequenceWidth(lead: number): number {
  if (lead <= 0x7f) return 1;
  if (lead >= 0xc2 && lead <= 0xdf) return 2;
  if (lead >= 0xe0 && lead <= 0xef) return 3;
  if (lead >= 0xf0 && lead <= 0xf4) return 4;
  return 0;
}

function utf8SequenceOk(bytes: Uint8Array, start: number, width: number): boolean {
  const lead = bytes[start] ?? 0;
  const second = width > 1 ? (bytes[start + 1] ?? 0) : 0;
  if (width > 1 && (second < 0x80 || second > 0xbf)) return false;
  if (lead === 0xe0 && second < 0xa0) return false;
  if (lead === 0xed && second > 0x9f) return false;
  if (lead === 0xf0 && second < 0x90) return false;
  if (lead === 0xf4 && second > 0x8f) return false;
  for (let index = 2; index < width; index += 1) {
    const cont = bytes[start + index] ?? 0;
    if (cont < 0x80 || cont > 0xbf) return false;
  }
  return true;
}

function scanTextLines(path: string, onLine: (line: string, lineNo: number) => boolean): "ok" | "binary" | "not_utf8" {
  const fd = openSync(path, "r");
  const buf = Buffer.alloc(65_536);
  let pending = Buffer.alloc(0);
  let lineNo = 0;
  let checkedBinary = false;
  try {
    const emit = (lineBytes: Uint8Array): "ok" | "not_utf8" | "next" => {
      const cut = utf8Cut(lineBytes, true);
      if (cut.error) return "not_utf8";
      lineNo += 1;
      return onLine(cut.text, lineNo) ? "next" : "ok";
    };
    const drain = (eof: boolean): "ok" | "not_utf8" | "next" => {
      while (true) {
        const newline = pending.indexOf(0x0a);
        if (newline === -1) return eof ? emit(pending) : "next";
        const lineBytes = pending.subarray(0, newline);
        pending = Buffer.from(pending.subarray(newline + 1));
        const status = emit(lineBytes);
        if (status !== "next") return status;
      }
    };
    while (true) {
      const n = readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      const chunk = buf.subarray(0, n);
      if (!checkedBinary) {
        checkedBinary = true;
        if (chunk.includes(0)) return "binary";
      }
      pending = Buffer.concat([pending, chunk]);
      const status = drain(false);
      if (status !== "next") return status;
    }
    const status = drain(true);
    return status === "not_utf8" ? "not_utf8" : "ok";
  } finally {
    closeSync(fd);
  }
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
