import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { createApiKey } from "../src/auth/keys.ts";
import { openDatabase } from "../src/db/database.ts";
import { updateSettings } from "../src/db/settings.ts";
import { approvalReason } from "../src/security/approval.ts";
import { editFile, readFile, writeFile } from "../src/tools/files.ts";
import { memoryForget, memorySave, memorySearch } from "../src/tools/memory.ts";
import { runShell, ShellGate } from "../src/tools/shell.ts";
import { testApp, testOperator } from "./harness.ts";
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

test("approval recognizes a sensitive target behind a symlink alias", () => {
  if (process.platform === "win32") return;
  const directory = temp();
  const target = join(directory, "private.pem");
  const alias = join(directory, "plain.txt");
  writeFileSync(target, "private");
  symlinkSync(target, alias);
  expect(approvalReason("write_file", { path: alias })).toBe("Perubahan file sensitif");
  expect(approvalReason("edit_file", { path: alias })).toBe("Perubahan file sensitif");
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

test("strict policy covers every shell command and audit redacts sensitive output", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  updateSettings(db, { shell_policy: "strict" });
  const key = createApiKey(db, "strict").secret;
  const command = await postMcp(app, "tools/call", { name: "shell", arguments: { command: "echo harmless" } }, key);
  expect(command.body.result?.content?.[0]?.text).toContain("approval_required");
  const directory = temp();
  const path = join(directory, ".env");
  writeFileSync(path, "PASSWORD=do-not-log");
  const read = await postMcp(app, "tools/call", { name: "read_file", arguments: { path } }, key);
  expect(read.body.result?.content?.[0]?.text).toContain("do-not-log");
  const row = db.query("SELECT result_text FROM tool_calls WHERE tool_name = 'read_file' ORDER BY started_at DESC LIMIT 1")
    .get() as { result_text: string };
  expect(row.result_text).not.toContain("do-not-log");
  expect(row.result_text).toContain("[redacted: sensitive file]");
  const write = await postMcp(app, "tools/call", {
    name: "write_file", arguments: { path, contents: "PASSWORD=new-do-not-log" },
  }, key);
  expect(write.body.result?.content?.[0]?.text).toContain("approval_required");
  expect(readFileSync(path, "utf8")).toBe("PASSWORD=do-not-log");
  const args = db.query("SELECT arguments_json FROM tool_calls WHERE tool_name = 'write_file' ORDER BY started_at DESC LIMIT 1")
    .get() as { arguments_json: string };
  expect(args.arguments_json).not.toContain("new-do-not-log");
  db.close();
});

test("approval storage omits raw shell commands but operator sees an ephemeral preview", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  const key = createApiKey(db, "redaction").secret;
  const secret = "placeholder-value-for-regression-only";
  const command = `printf '%s' '${secret}'`;
  const pending = await postMcp(app, "tools/call", { name: "shell", arguments: { command } }, key);
  expect(pending.body.result?.content?.[0]?.text).toContain("approval_required");
  const persisted = db.query("SELECT summary FROM approvals ORDER BY created_at DESC LIMIT 1").get() as { summary: string };
  expect(persisted.summary).not.toContain(secret);
  expect(persisted.summary).toContain("SHA-256");
  const call = db.query("SELECT arguments_json FROM tool_calls WHERE tool_name = 'shell' ORDER BY started_at DESC LIMIT 1")
    .get() as { arguments_json: string };
  expect(call.arguments_json).not.toContain(secret);
  const login = await app.request("/api/login", {
    method: "POST", headers: { host: "127.0.0.1", "content-type": "application/json" },
    body: JSON.stringify(testOperator),
  });
  const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const view = await app.request("/api/approvals", { headers: { host: "127.0.0.1", cookie } });
  expect(view.status).toBe(200);
  const payload = await view.json() as { data: { items: { preview: string }[] } };
  expect(payload.data.items[0]?.preview).toContain(secret);
  db.close();
});

test("file approval preview describes changed keys without persisting values", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  const key = createApiKey(db, "config-review").secret;
  const path = join(temp(), "private.pem");
  writeFileSync(path, "TOKEN=old-value\nSTABLE=same");
  const request = await postMcp(app, "tools/call", {
    name: "write_file",
    arguments: { path, contents: "TOKEN=new-sensitive-value\nSTABLE=same\nADDED=secret" },
  }, key);
  expect(request.body.result?.content?.[0]?.text).toContain("approval_required");
  const { summary } = db.query("SELECT summary FROM approvals ORDER BY created_at DESC LIMIT 1").get() as { summary: string };
  expect(summary).toContain("Keys changed: TOKEN");
  expect(summary).toContain("Keys added: ADDED");
  expect(summary).not.toContain("new-sensitive-value");
  expect(summary).not.toContain("secret\n");
  expect(readFileSync(path, "utf8")).toContain("old-value");
  db.close();
});

test("approval is one-time, bound to caller and exact arguments", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  const firstKey = createApiKey(db, "first").secret;
  const secondKey = createApiKey(db, "second").secret;
  const args = { command: "echo rm -rf" };
  expect(approvalReason("shell", args)).not.toBeNull();
  expect(approvalReason("shell", { command: "git status" }, "risky")).toBeNull();
  expect(approvalReason("shell", { command: "git status" })).not.toBeNull();
  expect(approvalReason("write_file", { path: "/tmp/.env" })).not.toBeNull();
  expect(approvalReason("shell", { command: "git -C /project push origin main" })).not.toBeNull();
  expect(approvalReason("shell", { command: "git push --force-with-lease origin develop" })).not.toBeNull();
  expect(approvalReason("shell", { command: "DROP TABLE users" })).not.toBeNull();
  expect(approvalReason("shell", { command: "DELETE FROM users;" })).not.toBeNull();
  expect(approvalReason("shell", { command: "DELETE FROM users WHERE id = 1" }, "risky")).toBeNull();
  const pending = await postMcp(app, "tools/call", { name: "shell", arguments: args }, firstKey);
  const text = pending.body.result?.content?.[0]?.text ?? "";
  expect(text).toContain("approval_required");
  const id = /request ([a-f0-9-]{36})/.exec(text)?.[1];
  expect(id).toBeTruthy();
  const unauthorized = await app.request(`/api/approvals/${id}/decision`, { method: "POST",
    headers: { host: "127.0.0.1", "content-type": "application/json" }, body: JSON.stringify({ decision: "approved" }) });
  expect(unauthorized.status).toBe(401);
  const session = await app.request("/api/login", { method: "POST",
    headers: { host: "127.0.0.1", "content-type": "application/json" }, body: JSON.stringify(testOperator) });
  const cookie = session.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const decision = await app.request(`/api/approvals/${id}/decision`, { method: "POST",
    headers: { host: "127.0.0.1", cookie, "content-type": "application/json" },
    body: JSON.stringify({ decision: "approved" }) });
  expect(decision.status).toBe(200);
  const other = await postMcp(app, "tools/call", { name: "shell", arguments: { ...args, approval_id: id } }, secondKey);
  expect(other.body.result?.content?.[0]?.text).toContain("approval_invalid");
  const changed = await postMcp(app, "tools/call", { name: "shell",
    arguments: { command: "echo rm -rf && echo extra", approval_id: id } }, firstKey);
  expect(changed.body.result?.content?.[0]?.text).toContain("approval_invalid");
  const accepted = await postMcp(app, "tools/call", { name: "shell", arguments: { ...args, approval_id: id } }, firstKey);
  expect(accepted.body.result?.isError).toBeUndefined();
  expect(accepted.body.result?.content?.[0]?.text).toContain("rm -rf");
  const reused = await postMcp(app, "tools/call", { name: "shell", arguments: { ...args, approval_id: id } }, firstKey);
  expect(reused.body.result?.content?.[0]?.text).toContain("approval_invalid");
  db.close();
});
