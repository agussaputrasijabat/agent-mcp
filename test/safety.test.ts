import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { createApiKey } from "../src/auth/keys.ts";
import { openDatabase } from "../src/db/database.ts";
import { sensitivePath } from "../src/security/sensitive-path.ts";
import { editFile, readFile, writeFile } from "../src/tools/files.ts";
import { memoryForget, memorySave, memorySearch } from "../src/tools/memory.ts";
import { runShell, ShellGate } from "../src/tools/shell.ts";
import { testApp } from "./harness.ts";
import { postMcp } from "./mcp-client.ts";

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
function temp(): string {
  const directory = mkdtempSync(join(tmpdir(), "agent-mcp-safety-"));
  directories.push(directory);
  return directory;
}
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

test("hash-guarded editing rejects stale reads and preserves file permissions", () => {
  const path = join(temp(), "config.ts");
  writeFileSync(path, "first\n");
  chmodSync(path, 0o600);
  const read = readFile({ path, include_hash: true }).content[0].text;
  expect(read).toStartWith(`sha256 ${digest("first\n")}\n`);
  writeFileSync(path, "second\n");
  const edit = editFile({ path, old_string: "second", new_string: "third", expected_hash: digest("first\n") });
  expect(edit.content[0].text).toStartWith("error file_changed:");
  expect(readFileSync(path, "utf8")).toBe("second\n");
  expect(editFile({ path, old_string: "second", new_string: "third", expected_hash: digest("second\n") }).isError)
    .toBeUndefined();
  expect(readFileSync(path, "utf8")).toBe("third\n");
  expect(lstatSync(path).mode & 0o777).toBe(0o600);
  expect(writeFile({ path, contents: "fourth\n", expected_hash: "absent" }).content[0].text)
    .toStartWith("error file_changed:");
  expect(writeFile({ path, contents: "fourth\n", expected_hash: digest("third\n") }).isError).toBeUndefined();
  expect(readFileSync(path, "utf8")).toBe("fourth\n");
  const fresh = join(temp(), "fresh.txt");
  expect(writeFile({ path: fresh, contents: "new", expected_hash: "absent" }).isError).toBeUndefined();
  expect(writeFile({ path: fresh, contents: "bad", expected_hash: "absent" }).isError).toBe(true);
});

test("version hashing refuses large files instead of blocking on a full scan", () => {
  const path = join(temp(), "large.txt");
  writeFileSync(path, "");
  truncateSync(path, 9 * 1024 * 1024);
  expect(readFile({ path, include_hash: true }).content[0].text).toContain("hash_too_large");
  expect(writeFile({ path, contents: "replacement", expected_hash: digest("") }).content[0].text).toContain("hash_too_large");
});

test("file locks reject another writer and preserve the original", () => {
  const path = join(temp(), "shared.ts");
  writeFileSync(path, "before");
  mkdirSync(`${path}.agent-mcp.lock`);
  try {
    expect(writeFile({ path, contents: "lost", expected_hash: digest("before") }).content[0].text)
      .toContain("file_busy");
    expect(editFile({ path, old_string: "before", new_string: "lost", expected_hash: digest("before") }).content[0].text)
      .toContain("file_busy");
    expect(readFileSync(path, "utf8")).toBe("before");
  } finally {
    rmdirSync(`${path}.agent-mcp.lock`);
  }
});

test("competing Agent MCP processes cannot both overwrite the same version", async () => {
  const path = join(temp(), "shared.txt");
  writeFileSync(path, "original");
  const source = JSON.stringify(join(process.cwd(), "src/tools/files.ts"));
  const script = `import { writeFile } from ${source};
    const result = writeFile({ path: ${JSON.stringify(path)}, contents: process.argv.at(-1)!, expected_hash: ${JSON.stringify(digest("original"))} });
    console.log(result.content[0].text);`;
  const run = (content: string) => Bun.spawn(["bun", "-e", script, content], { stdout: "pipe", stderr: "pipe" });
  const first = run("alpha");
  const second = run("beta");
  const [firstExit, secondExit, firstText, secondText] = await Promise.all([
    first.exited, second.exited, new Response(first.stdout).text(), new Response(second.stdout).text(),
  ]);
  expect(firstExit).toBe(0);
  expect(secondExit).toBe(0);
  const results = [firstText, secondText];
  expect(results.filter((value) => value.includes("wrote "))).toHaveLength(1);
  expect(results.some((value) => value.includes("file_busy") || value.includes("file_changed"))).toBe(true);
  expect(["alpha", "beta"]).toContain(readFileSync(path, "utf8"));
});

test("atomic file writes do not replace symlink paths", () => {
  if (process.platform === "win32") return;
  const directory = temp();
  const target = join(directory, "actual.txt");
  const link = join(directory, "linked.txt");
  writeFileSync(target, "unchanged");
  symlinkSync(target, link);
  expect(writeFile({ path: link, contents: "overwrite" }).content[0].text).toStartWith("error symlink_not_allowed:");
  expect(editFile({ path: link, old_string: "unchanged", new_string: "overwrite" }).isError).toBe(true);
  expect(readFileSync(target, "utf8")).toBe("unchanged");
});

test("sensitive file paths are recognized through symlink aliases", () => {
  if (process.platform === "win32") return;
  const directory = temp();
  const target = join(directory, "private.pem");
  const alias = join(directory, "plain.txt");
  writeFileSync(target, "private");
  symlinkSync(target, alias);
  expect(sensitivePath(alias)).toBe(true);
  expect(sensitivePath(join(directory, "normal.txt"))).toBe(false);
});

test("memory keys are independent between global and project scopes", () => {
  const db = openDatabase(":memory:");
  db.query(`INSERT INTO memories (id,key,body,project_path,created_at,updated_at)
    VALUES ('legacy', 'shared', 'old project', '/legacy', '2026-01-01', '2026-01-01')`).run();
  expect(memorySave(db, { key: "shared", body: "global" }).isError).toBeUndefined();
  expect(memorySave(db, { key: "shared", body: "project A", project_path: "/app/a" }).isError).toBeUndefined();
  expect(memorySave(db, { key: "shared", body: "project B", project_path: "/app/b" }).isError).toBeUndefined();
  expect(memorySearch(db, { query: "shared" }).content[0].text).toContain("global");
  expect(memorySearch(db, { query: "shared", project_path: "/app/a" }).content[0].text).toContain("project A");
  expect(memorySearch(db, { query: "shared", project_path: "/app/a" }).content[0].text).not.toContain("project B");
  expect(memorySearch(db, { query: "shared", project_path: "/legacy" }).content[0].text).toContain("old project");
  expect(memoryForget(db, { key: "shared", project_path: "/app/a" }).isError).toBeUndefined();
  expect(memorySearch(db, { query: "shared", project_path: "/app/a" }).content[0].text).not.toContain("project A");
  expect(memorySearch(db, { query: "shared", project_path: "/app/b" }).content[0].text).toContain("project B");
  db.close();
});

test("shell output is bounded before returning to the client", async () => {
  const result = await runShell({ command: "head -c 150000 /dev/zero | tr '\\0' a" }, new ShellGate(1));
  expect(result.isError).toBeUndefined();
  expect(result.content[0].text.length).toBeLessThan(31_000);
  expect(result.content[0].text).toContain("[truncated]");
});

test("MCP exposes destructive hints and delegates confirmation to the client", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  const key = createApiKey(db, "native-approval").secret;
  const listing = await postMcp(app, "tools/list", {}, key);
  expect(listing.status).toBe(200);
  for (const name of ["write_file", "edit_file", "shell", "memory_forget", "skill_delete"]) {
    const tool = listing.body.result?.tools?.find((entry) => entry.name === name);
    expect(tool?.annotations?.readOnlyHint).toBe(false);
    expect(tool?.annotations?.destructiveHint).toBe(true);
  }
  expect(listing.body.result?.tools?.find((entry) => entry.name === "read_file")?.annotations?.readOnlyHint).toBe(true);

  const shell = await postMcp(app, "tools/call", {
    name: "shell", arguments: { command: "printf native-confirmation" },
  }, key);
  expect(shell.body.result?.isError).toBeUndefined();
  expect(shell.body.result?.content?.[0]?.text).toContain("native-confirmation");

  const path = join(temp(), ".env");
  writeFileSync(path, "TOKEN=before");
  const write = await postMcp(app, "tools/call", {
    name: "write_file", arguments: { path, contents: "TOKEN=after" },
  }, key);
  expect(write.body.result?.isError).toBeUndefined();
  expect(readFileSync(path, "utf8")).toBe("TOKEN=after");

  expect(memorySave(db, { key: "temporary", body: "note" }).isError).toBeUndefined();
  const forgotten = await postMcp(app, "tools/call", {
    name: "memory_forget", arguments: { key: "temporary" },
  }, key);
  expect(forgotten.body.result?.isError).toBeUndefined();
  expect(memorySearch(db, { query: "temporary" }).content[0].text).toBe("");

  const count = db.query("SELECT COUNT(*) AS n FROM approvals").get() as { n: number };
  expect(count.n).toBe(0);
  db.close();
});

test("native tool calls keep sensitive arguments and output out of the audit database", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  const key = createApiKey(db, "audit").secret;
  const secret = "sample-token-not-a-credential";
  const path = join(temp(), "private.pem");
  writeFileSync(path, secret);
  const read = await postMcp(app, "tools/call", {
    name: "read_file", arguments: { path },
  }, key);
  expect(read.body.result?.content?.[0]?.text).toContain(secret);
  const readRow = db.query("SELECT result_text FROM tool_calls WHERE tool_name = 'read_file' LIMIT 1")
    .get() as { result_text: string };
  expect(readRow.result_text).not.toContain(secret);

  const command = `printf '%s' '${secret}'`;
  const result = await postMcp(app, "tools/call", {
    name: "shell", arguments: { command },
  }, key);
  expect(result.body.result?.content?.[0]?.text).toContain(secret);
  const shellRow = db.query("SELECT arguments_json, result_text FROM tool_calls WHERE tool_name = 'shell' LIMIT 1")
    .get() as { arguments_json: string; result_text: string };
  expect(shellRow.arguments_json).not.toContain(secret);
  expect(shellRow.result_text).not.toContain(secret);
  expect(shellRow.arguments_json).toContain("command omitted");
  const write = await postMcp(app, "tools/call", {
    name: "write_file", arguments: { path, contents: "TOKEN=new-private-value" },
  }, key);
  expect(write.body.result?.isError).toBeUndefined();
  const writeRow = db.query("SELECT arguments_json FROM tool_calls WHERE tool_name = 'write_file' LIMIT 1")
    .get() as { arguments_json: string };
  expect(writeRow.arguments_json).not.toContain("new-private-value");
  db.close();
});
