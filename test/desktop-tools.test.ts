import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDirectory, listDirectory, movePath, statPath } from "../src/tools/filesystem-extra.ts";
import { ProcessSessions } from "../src/tools/process-sessions.ts";
import { executeCode } from "../src/tools/code-execution.ts";
import { createSpreadsheet, editSpreadsheet, readSpreadsheet, searchSpreadsheet, inspectTabular } from "../src/tools/spreadsheet.ts";
import { createPdf, readPdf, editPdf } from "../src/tools/pdf.ts";
import { createDocx, readDocx, editDocx, searchDocx } from "../src/tools/docx.ts";
import { previewFile } from "../src/tools/file-preview.ts";
import { createApiKey } from "../src/auth/keys.ts";
import { openDatabase } from "../src/db/database.ts";
import { testApp } from "./harness.ts";
import { postMcp } from "./mcp-client.ts";
import { readServerInstructions } from "../src/mcp/instructions.ts";

const dirs: string[] = [];
function temp(): string { const p = mkdtempSync(join(tmpdir(), "agent-tools-")); dirs.push(p); return p; }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

test("filesystem extended lists, describes and moves without overwrite", async () => {
  const dir = temp(), folder = join(dir, "nested");
  expect((await createDirectory({ path: folder, recursive: true })).isError).toBeUndefined();
  writeFileSync(join(folder, "a.txt"), "hello");
  const listing = JSON.parse((await listDirectory({ path: dir, depth: 2, limit: 20, offset: 0 })).content[0].text);
  expect(listing.entries.some((x: { path: string }) => x.path.endsWith("a.txt"))).toBe(true);
  expect(JSON.parse((await statPath({ path: join(folder, "a.txt") })).content[0].text).size).toBe(5);
  const from = join(folder, "a.txt"), to = join(folder, "b.txt");
  expect((await movePath({ source: from, destination: to })).isError).toBeUndefined();
  expect(readFileSync(to, "utf8")).toBe("hello");
  expect((await movePath({ source: folder, destination: join(folder, "child") })).isError).toBe(true);
  expect((await movePath({ source: to, destination: to })).isError).toBe(true);
});

test("process sessions provide paginated output and input", async () => {
  if (process.platform === "win32") return;
  const manager = new ProcessSessions();
  const started = await manager.start({ command: "read line; printf 'reply:%s\\n' \"$line\"", timeout_ms: 4000 });
  expect(started.isError).toBeUndefined();
  const id: string = JSON.parse(started.content[0].text).session_id;
  expect(manager.write({ session_id: id, input: "hello\n", end: true }).isError).toBeUndefined();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const first = manager.read({ session_id: id, offset: 0, length: 6 });
  const start = JSON.parse(first.content[0].text);
  expect(start.output).toBe("reply:");
  const rest = JSON.parse(manager.read({ session_id: id, offset: start.next_offset, length: 100 }).content[0].text);
  expect(rest.output).toContain("hello");
  expect(rest.status).toBe("finished");
  expect(manager.list().content[0].text).toContain(id);
  expect(manager.terminate({ session_id: id }).isError).toBeUndefined();
});

test("execute_code runs javascript without script files", async () => {
  const result = await executeCode({ language: "javascript", code: "console.log(3 * 7)", timeout_ms: 5000 });
  if (result.isError && result.content[0].text.includes("runtime_unavailable")) return;
  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toContain("21");
});

test("execute_code uses Python -c and reports non-zero status", async () => {
  const good = await executeCode({ language: "python", code: "print(6 * 7)", timeout_ms: 5000 });
  if (good.isError && good.content[0].text.includes("runtime_unavailable")) return;
  expect(good.isError).toBeUndefined();
  expect(good.content[0].text).toContain("42");
  const bad = await executeCode({ language: "python", code: "raise RuntimeError('test')", timeout_ms: 5000 });
  expect(bad.isError).toBe(true);
  expect(bad.content[0].text).toContain("execution_failed");
});

test("XLSX round trip and tabular analysis", async () => {
  const dir = temp(), path = join(dir, "report.xlsx");
  expect((await createSpreadsheet({ path, sheet: "Data", rows: [["Name", "Amount"], ["A", 10], ["B", 20]] })).isError).toBeUndefined();
  const read = await readSpreadsheet({ path, sheet: "Data", limit: 4, row_offset: 0 });
  expect(JSON.parse(read.content[0].text).rows[1][0]).toBe("A");
  expect((await editSpreadsheet({ path, sheet: "Data", cells: { B2: 15 } })).isError).toBeUndefined();
  const matches = await searchSpreadsheet({ path, query: "15", limit: 20 });
  expect(JSON.parse(matches.content[0].text).matches[0].cell).toBe("B2");
  const summary = JSON.parse((await inspectTabular({ path, limit: 10 })).content[0].text);
  expect(summary.columns[1].average).toBe(17.5);
  expect((await editSpreadsheet({ path: join(dir, "macros.xlsm"), sheet: "Data", cells: { A1: "X" } })).isError).toBe(true);
});

test("PDF generation, extraction and rotation", async () => {
  const path = join(temp(), "manual.pdf");
  expect((await createPdf({ path, markdown: "# Heading\nHello world" })).isError).toBeUndefined();
  const read = await readPdf({ path, start_page: 1 });
  expect(read.content[0].text).toContain("Hello world");
  expect((await editPdf({ path, operation: "rotate_pages", pages: [1], degrees: 90 })).isError).toBeUndefined();
  expect((await editPdf({ path, operation: "delete_pages", pages: [1] })).isError).toBe(true);
});

test("DOCX generation, content search and surgical edit", async () => {
  const path = join(temp(), "draft.docx");
  expect((await createDocx({ path, markdown: "# Hello\nAlpha bravo" })).isError).toBeUndefined();
  expect((await readDocx({ path, limit: 10 })).content[0].text).toContain("Alpha bravo");
  expect((await searchDocx({ path, query: "alpha" })).content[0].text).toContain("Alpha bravo");
  expect((await editDocx({ path, old_string: "Alpha", new_string: "Beta" })).isError).toBeUndefined();
  expect((await readDocx({ path, limit: 10 })).content[0].text).toContain("Beta bravo");
  expect((await previewFile({ path })).content[0].text).toContain("Beta bravo");
});

test("preview_file exposes MCP Apps resource and fallback tool output", async () => {
  const dir = temp(), path = join(dir, "note.md");
  writeFileSync(path, "# Hello");
  const db = openDatabase(":memory:");
  const app = await testApp(db, { instructions: readServerInstructions() });
  const key = createApiKey(db, "preview").secret;
  const list = await postMcp(app, "tools/list", undefined, key);
  expect(list.body.result?.tools?.some((item) => item.name === "preview_file")).toBe(true);
  const call = await postMcp(app, "tools/call", { name: "preview_file", arguments: { path } }, key);
  expect(call.body.result?.content?.[0]?.text).toContain("# Hello");
  const resources = await postMcp(app, "resources/list", undefined, key);
  expect(resources.status).toBe(200);
  const resource = await postMcp(app, "resources/read", { uri: "ui://agent-mcp/file-preview" }, key);
  expect(resource.status).toBe(200);
  expect(JSON.stringify(resource.body)).toContain("File Preview");
});
