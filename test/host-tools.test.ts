import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createApp } from "../src/app.ts";
import { assertInstructions, readServerInstructions } from "../src/mcp/instructions.ts";
import { editFile, findFiles, readFile, searchFiles, writeFile } from "../src/tools/files.ts";
import { runShell, ShellGate } from "../src/tools/shell.ts";
import { fetchUrl, isBlockedAddress } from "../src/tools/web-fetch.ts";
import { postMcp } from "./mcp-client.ts";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "agent-mcp-"));
  directories.push(directory);
  return directory;
}

test("read_file returns file text", () => {
  const directory = tempDir();
  const path = join(directory, "note.txt");
  writeFileSync(path, "hello");
  const result = readFile({ path });
  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toBe("hello");
});

test("read_file rejects a relative path", () => {
  const result = readFile({ path: "note.txt" });
  expect(result.content[0].text.startsWith("error path_not_absolute:")).toBe(true);
});

test("read_file reports an empty range", () => {
  const directory = tempDir();
  const path = join(directory, "note.txt");
  writeFileSync(path, "only");
  const result = readFile({ path, offset: 5 });
  expect(result.content[0].text).toBe("notice empty_range");
});

test("read_file rejects a directory and invalid utf-8", () => {
  const directory = tempDir();
  expect(readFile({ path: directory }).content[0].text.startsWith("error is_directory:")).toBe(true);
  const path = join(directory, "bin.dat");
  writeFileSync(path, Buffer.from([0xff, 0xfe]));
  expect(readFile({ path }).content[0].text.startsWith("error not_utf8:")).toBe(true);
});

test("write_file creates parent directories and replaces contents", () => {
  const directory = tempDir();
  const path = join(directory, "nested", "note.txt");
  expect(writeFile({ path, contents: "one" }).isError).toBeUndefined();
  expect(readFile({ path }).content[0].text).toBe("one");
  writeFile({ path, contents: "two" });
  expect(readFile({ path }).content[0].text).toBe("two");
});

test("write_file rejects an oversized body", () => {
  const result = writeFile({ path: "/tmp/too-big.txt", contents: "x".repeat(1_000_001) });
  expect(result.content[0].text.startsWith("error body_too_large:")).toBe(true);
});

test("edit_file replaces one match and reports misses", () => {
  const directory = tempDir();
  const path = join(directory, "note.txt");
  writeFileSync(path, "alpha beta");
  expect(editFile({ path, old_string: "alpha", new_string: "gamma" }).isError).toBeUndefined();
  expect(readFile({ path }).content[0].text).toBe("gamma beta");
  expect(editFile({ path, old_string: "missing", new_string: "x" }).content[0].text.startsWith("error edit_not_found:")).toBe(true);
  writeFileSync(path, "a a");
  expect(editFile({ path, old_string: "a", new_string: "b" }).content[0].text.startsWith("error edit_not_unique:")).toBe(true);
  expect(readFile({ path }).content[0].text).toBe("a a");
  expect(editFile({ path, old_string: "a", new_string: "a" }).content[0].text.startsWith("error edit_noop:")).toBe(true);
});

test("glob lists matches and an empty directory", () => {
  const directory = tempDir();
  writeFileSync(join(directory, "a.ts"), "");
  writeFileSync(join(directory, "b.ts"), "");
  writeFileSync(join(directory, "c.txt"), "");
  const found = findFiles({ pattern: "*.ts", path: directory });
  expect(found.isError).toBeUndefined();
  expect(found.content[0].text.split("\n")).toHaveLength(2);
  const empty = tempDir();
  expect(findFiles({ pattern: "*.ts", path: empty }).content[0].text).toBe("");
});

test("grep rejects a bad regex and caps matches", () => {
  expect(searchFiles({ pattern: "(", path: tempDir() }).content[0].text.startsWith("error invalid_regex:")).toBe(true);
  const directory = tempDir();
  writeFileSync(join(directory, "hits.txt"), Array.from({ length: 101 }, () => "hit").join("\n"));
  mkdirSync(join(directory, "node_modules"));
  writeFileSync(join(directory, "node_modules", "hidden.txt"), "hit");
  const result = searchFiles({ pattern: "hit", path: directory });
  const lines = result.content[0].text.split("\n").filter((line) => line.includes("hits.txt"));
  expect(lines).toHaveLength(100);
  expect(result.content[0].text).toContain("notice match_capped");
  expect(result.content[0].text).not.toContain("hidden.txt");
});

test("write_file reports eacces", () => {
  const directory = tempDir();
  chmodSync(directory, 0o555);
  const result = writeFile({ path: join(directory, "nope.txt"), contents: "x" });
  chmodSync(directory, 0o755);
  expect(result.content[0].text.startsWith("error eacces:")).toBe(true);
});

test("shell returns exit codes and rejects a bad timeout or cwd", async () => {
  const gate = new ShellGate(4);
  const okResult = await runShell({ command: "echo ok" }, gate);
  expect(okResult.isError).toBeUndefined();
  expect(okResult.content[0].text).toContain("exit code 0");
  expect(okResult.content[0].text).toContain("ok");
  const failed = await runShell({ command: "exit 1" }, gate);
  expect(failed.isError).toBeUndefined();
  expect(failed.content[0].text).toContain("exit code 1");
  expect((await runShell({ command: "echo x", timeout_ms: 999 }, gate)).content[0].text.startsWith("error invalid_timeout:")).toBe(true);
  expect((await runShell({ command: "echo x", cwd: "/tmp/does-not-exist-agent-mcp" }, gate)).content[0].text.startsWith("error cwd_not_found:")).toBe(true);
});

test("shell times out and reports busy", async () => {
  const gate = new ShellGate(1);
  const timed = await runShell({ command: "sleep 5", timeout_ms: 1000 }, gate);
  expect(timed.content[0].text.startsWith("error shell_timeout:")).toBe(true);
  const running = runShell({ command: "sleep 1" }, gate);
  const busy = await runShell({ command: "echo no" }, gate);
  expect(busy.content[0].text.startsWith("error shell_busy:")).toBe(true);
  await running;
});

test("two shells run at the same time", async () => {
  const gate = new ShellGate(32);
  const started = performance.now();
  const [first, second] = await Promise.all([
    runShell({ command: "sleep 2" }, gate),
    runShell({ command: "sleep 2" }, gate),
  ]);
  expect(performance.now() - started).toBeLessThan(3500);
  expect(first.content[0].text).toContain("exit code 0");
  expect(second.content[0].text).toContain("exit code 0");
});

test("web_fetch blocks private addresses and returns http status", async () => {
  expect(isBlockedAddress("127.0.0.1")).toBe(true);
  expect(isBlockedAddress("10.1.2.3")).toBe(true);
  expect(isBlockedAddress("8.8.8.8")).toBe(false);
  const blocked = await fetchUrl({ url: "http://127.0.0.1/" });
  expect(blocked.content[0].text.startsWith("error fetch_blocked:")).toBe(true);
  const missing = await fetchUrl(
    { url: "https://example.test/missing" },
    {
      lookup: async () => ["8.8.8.8"],
      fetch: async () => new Response("gone", { status: 404 }),
    },
  );
  expect(missing.isError).toBeUndefined();
  expect(missing.content[0].text).toContain("status 404");
  const okResult = await fetchUrl(
    { url: "https://example.com/hello" },
    {
      lookup: async () => ["8.8.8.8"],
      fetch: async () => new Response("hello", { status: 200 }),
    },
  );
  expect(okResult.content[0].text).toContain("status 200");
  expect(okResult.content[0].text).toContain("hello");
  const failed = await fetchUrl(
    { url: "https://missing.example/" },
    { lookup: async () => { throw new Error("no dns"); } },
  );
  expect(failed.content[0].text.startsWith("error fetch_failed:")).toBe(true);
});

test("tools/list exposes seven host tools and instructions", async () => {
  const db = new Database(":memory:");
  const app = createApp(db, { instructions: readServerInstructions() });
  const listed = await postMcp(app, "tools/list");
  const names = listed.body.result?.tools?.map((tool) => tool.name) ?? [];
  expect(names).toEqual(["read_file", "write_file", "edit_file", "glob", "grep", "shell", "web_fetch"]);
  const read = listed.body.result?.tools?.find((tool) => tool.name === "read_file");
  const shell = listed.body.result?.tools?.find((tool) => tool.name === "shell");
  expect(read?.annotations?.readOnlyHint).toBe(true);
  expect(shell?.annotations?.readOnlyHint).toBe(false);
  expect(shell?.annotations?.destructiveHint).toBe(true);
  const initialized = await postMcp(app, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  });
  expect(initialized.body.result?.serverInfo?.instructions).toBe(readServerInstructions());
  expect(assertInstructions(readServerInstructions()).length).toBe(354);
});
