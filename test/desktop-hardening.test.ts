import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import PizZip from "pizzip";
import { createSpreadsheet, editSpreadsheet, readSpreadsheet, searchSpreadsheet } from "../src/tools/spreadsheet.ts";
import { createDocx, editDocx, readDocx } from "../src/tools/docx.ts";
import { createPdf, editPdf, readPdf } from "../src/tools/pdf.ts";
import { movePath } from "../src/tools/filesystem-extra.ts";
import { previewFile } from "../src/tools/file-preview.ts";
import { ProcessSessions } from "../src/tools/process-sessions.ts";
import { openInFolder } from "../src/tools/open-folder.ts";
import { isStructuredDocument } from "../web/src/preview-kind.ts";
import { openDatabase } from "../src/db/database.ts";
import { testApp } from "./harness.ts";
import { createApiKey } from "../src/auth/keys.ts";
import { postMcp } from "./mcp-client.ts";
import { readServerInstructions } from "../src/mcp/instructions.ts";

const directories: string[] = [];
function temp(): string {
  const directory = mkdtempSync(join(tmpdir(), "agent-hardening-"));
  directories.push(directory);
  return directory;
}
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});

test("large Markdown previews never expose an editable hash", async () => {
  const path = join(temp(), "long.md");
  writeFileSync(path, "# Document\n" + "a".repeat(45_000) + "\nEND_MARKER");
  const result = await previewFile({ path });
  expect(result.isError).toBeUndefined();
  expect(result.content[0].text.startsWith("sha256 ")).toBe(false);
  expect(readFileSync(path, "utf8")).toContain("END_MARKER");
  const shortPath = join(temp(), "short.md");
  writeFileSync(shortPath, "# Short\nhello");
  expect((await previewFile({ path: shortPath })).content[0].text.startsWith("sha256 ")).toBe(true);
});

test("file and directory moves never overwrite an existing destination", async () => {
  const dir = temp();
  const src = join(dir, "src.txt"), dest = join(dir, "dest.txt");
  writeFileSync(src, "ORIGINAL");
  writeFileSync(dest, "PRESERVE");
  expect((await movePath({ source: src, destination: dest })).isError).toBe(true);
  expect(readFileSync(dest, "utf8")).toBe("PRESERVE");
  expect(readFileSync(src, "utf8")).toBe("ORIGINAL");
  const dirSrc = join(dir, "source-folder"), dirDest = join(dir, "new-folder");
  mkdirSync(dirSrc);
  writeFileSync(join(dirSrc, "inside.txt"), "inside");
  expect((await movePath({ source: dirSrc, destination: dirDest })).isError).toBeUndefined();
  expect(readFileSync(join(dirDest, "inside.txt"), "utf8")).toBe("inside");
});

test("document edits reject locks without changing files", async () => {
  const dir = temp(), doc = join(dir, "doc.docx"), pdf = join(dir, "doc.pdf"), xlsx = join(dir, "data.xlsx");
  expect((await createDocx({ path: doc, markdown: "Before" })).isError).toBeUndefined();
  expect((await createPdf({ path: pdf, markdown: "Before" })).isError).toBeUndefined();
  expect((await createSpreadsheet({ path: xlsx, sheet: "Data", rows: [["Title"], ["Before"]] })).isError).toBeUndefined();
  for (const path of [doc, pdf, xlsx]) mkdirSync(path + ".agent-mcp.lock");
  try {
    const word = await editDocx({ path: doc, old_string: "Before", new_string: "After" });
    const page = await editPdf({ path: pdf, operation: "rotate_pages", pages: [1], degrees: 90 });
    const excel = await editSpreadsheet({ path: xlsx, sheet: "Data", cells: { A2: "After" } });
    for (const result of [word, page, excel]) {
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("file_busy");
    }
  } finally {
    for (const path of [doc, pdf, xlsx]) rmSync(path + ".agent-mcp.lock", { recursive: true });
  }
  expect((await readDocx({ path: doc, limit: 10 })).content[0].text).toContain("Before");
  expect((await readPdf({ path: pdf, start_page: 1 })).isError).toBeUndefined();
  expect((await readSpreadsheet({ path: xlsx, limit: 5, row_offset: 0 })).content[0].text).toContain("Before");
});

test("maliciously high ZIP expansion is rejected before loading Office files", async () => {
  const dir = temp();
  const zip = new PizZip();
  zip.file("word/document.xml", "X".repeat(650_000));
  const buffer = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
  const docx = join(dir, "bomb.docx"), xlsx = join(dir, "bomb.xlsx");
  writeFileSync(docx, buffer);
  writeFileSync(xlsx, buffer);
  const word = await readDocx({ path: docx, limit: 10 });
  const excel = await readSpreadsheet({ path: xlsx, limit: 5, row_offset: 0 });
  expect(word.isError).toBe(true);
  expect(excel.isError).toBe(true);
  expect(word.content[0].text).toContain("zip_limit");
  expect(excel.content[0].text).toContain("zip_limit");
});

test("document writes reject stale fingerprints without overwriting external updates", async () => {
  const dir = temp();
  const path = join(dir, "concurrent.docx"), other = join(dir, "newer.docx");
  expect((await createDocx({ path, markdown: "Old revision" })).isError).toBeUndefined();
  expect((await createDocx({ path: other, markdown: "Newer revision" })).isError).toBeUndefined();
  const { fileFingerprint } = await import("../src/tools/document-safety.ts");
  const { writeDocument } = await import("../src/tools/document-files.ts");
  const expected = await fileFingerprint(path);
  const original = readFileSync(path);
  const newer = readFileSync(other);
  writeFileSync(path, newer);
  const result = await writeDocument(path, original, true, expected);
  expect(result?.isError).toBe(true);
  expect(result?.content[0].text).toContain("file_changed");
  expect(readFileSync(path).equals(newer)).toBe(true);
});

test("large spreadsheet previews remain valid JSON and paginate", async () => {
  const path = join(temp(), "large.xlsx");
  const rows = [["Value"], ...Array.from({ length: 150 }, (_, i) => [String(i) + "x".repeat(800)])];
  expect((await createSpreadsheet({ path, sheet: "Data", rows })).isError).toBeUndefined();
  const first = await readSpreadsheet({ path, limit: 150, row_offset: 0 });
  expect(first.isError).toBeUndefined();
  const parsed = JSON.parse(first.content[0].text) as { rows: unknown[][]; next_row_offset: number | null; truncated: boolean };
  expect(parsed.rows.length).toBeGreaterThan(0);
  expect(parsed.rows.length).toBeLessThan(150);
  expect(parsed.truncated).toBe(true);
  expect(parsed.next_row_offset).toBeGreaterThan(0);
  const second = await readSpreadsheet({ path, limit: 150, row_offset: parsed.next_row_offset! });
  expect(JSON.parse(second.content[0].text).row_offset).toBe(parsed.next_row_offset);
  const matches = await searchSpreadsheet({ path, query: "xx", limit: 100 });
  expect(matches.isError).toBeUndefined();
  expect(() => JSON.parse(matches.content[0].text)).not.toThrow();
});

test("Office extensions are recognized for structured preview", () => {
  expect(isStructuredDocument("/tmp/table.xlsx")).toBe(true);
  expect(isStructuredDocument("/tmp/table.xlsm")).toBe(true);
  expect(isStructuredDocument("/tmp/document.docx")).toBe(true);
  expect(isStructuredDocument("/tmp/pages.pdf")).toBe(true);
  expect(isStructuredDocument("/tmp/readme.md")).toBe(false);
});

test("edit_docx audit never stores sensitive replacement strings", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db, { instructions: readServerInstructions() });
  const key = createApiKey(db, "audit").secret;
  const oldValue = "private-old-unique-token";
  const newValue = "private-new-unique-token";
  await postMcp(app, "tools/call", { name: "edit_docx", arguments: { path: join(temp(), "missing.docx"), old_string: oldValue, new_string: newValue } }, key);
  const row = db.query("SELECT arguments_json FROM tool_calls WHERE tool_name = 'edit_docx'").get() as { arguments_json: string };
  expect(row.arguments_json).not.toContain(oldValue);
  expect(row.arguments_json).not.toContain(newValue);
});

test("file manager launch errors are returned instead of silent success", async () => {
  if (process.platform !== "darwin" && process.platform !== "linux") return;
  const dir = temp(), path = join(dir, "file.txt");
  writeFileSync(path, "x");
  const previous = process.env.PATH;
  process.env.PATH = dir;
  try {
    const result = await openInFolder({ path });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("launcher_failed");
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
});

test("stopping a process does not free a session slot before child closes", async () => {
  if (process.platform === "win32") return;
  const sessions = new ProcessSessions();
  const ids: string[] = [];
  try {
    for (let i = 0; i < 16; i++) {
      const result = await sessions.start({ command: "sleep 8", timeout_ms: 10_000 });
      expect(result.isError).toBeUndefined();
      ids.push(JSON.parse(result.content[0].text).session_id);
    }
    sessions.terminate({ session_id: ids[0]! });
    const denied = await sessions.start({ command: "printf extra", timeout_ms: 1000 });
    expect(denied.isError).toBe(true);
    expect(denied.content[0].text).toContain("session_limit");
  } finally {
    for (const id of ids) sessions.terminate({ session_id: id });
  }
});
