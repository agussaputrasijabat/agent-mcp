import { randomBytes } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, expect, test } from "bun:test";
import { createApiKey } from "../src/auth/keys.ts";
import { openDatabase } from "../src/db/database.ts";
import { testApp } from "./harness.ts";
import { assertInstructions, readServerInstructions } from "../src/mcp/instructions.ts";
import { IMAGE_BASE64_CHAR_LIMIT, OUTPUT_CHAR_LIMIT } from "../src/limits.ts";
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

function noisyPng(width: number, height: number): Buffer {
  const rowBytes = 1 + width * 3;
  const raw = Buffer.alloc(height * rowBytes);
  const pixels = randomBytes(width * height * 3);
  for (let y = 0; y < height; y++) {
    const dest = y * rowBytes;
    const source = y * width * 3;
    pixels.copy(raw, dest + 1, source, source + width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 0 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(tag: string, data: Buffer): Buffer {
  const type = Buffer.from(tag, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])) >>> 0);
  return Buffer.concat([length, type, data, crc]);
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

test("read_file caps text at the output limit", () => {
  const directory = tempDir();
  const path = join(directory, "big.txt");
  writeFileSync(path, "a".repeat(OUTPUT_CHAR_LIMIT + 25));
  const result = readFile({ path });
  expect(result.isError).toBeUndefined();
  expect(result.content[0].text.endsWith("\n[truncated]")).toBe(true);
  expect(result.content[0].text.length).toBe(OUTPUT_CHAR_LIMIT + "\n[truncated]".length);
});

test("read_file limit stops before a later invalid byte", () => {
  const directory = tempDir();
  const path = join(directory, "win.txt");
  writeFileSync(path, Buffer.concat([Buffer.from("one\ntwo\n"), Buffer.from([0xff])]));
  const result = readFile({ path, limit: 1 });
  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toBe("one");
});

test("read_file keeps an empty line inside the window", () => {
  const directory = tempDir();
  const path = join(directory, "gap.txt");
  writeFileSync(path, "line1\n\nline3");
  expect(readFile({ path, offset: 2, limit: 2 }).content[0].text).toBe("\nline3");
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

test("read_file returns an image block for a png and text for a text file", () => {
  const directory = tempDir();
  const imagePath = join(directory, "dot.png");
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
    "base64",
  );
  writeFileSync(imagePath, png);
  const image = readFile({ path: imagePath });
  expect(image.isError).toBeUndefined();
  const block = image.content.find((item) => item.type === "image");
  expect(block?.type).toBe("image");
  if (block?.type === "image") {
    expect(block.mimeType).toBe("image/png");
    expect(block.data).toBe(png.toString("base64"));
    expect(block.data).not.toContain("[truncated]");
  }
  expect(image.content[0].text).toContain(imagePath);
  expect(image.content[0].text).toContain("1×1");
  expect(image.content[0].text).not.toContain(png.toString("base64"));

  const textPath = join(directory, "note.txt");
  writeFileSync(textPath, "hello");
  expect(readFile({ path: textPath }).content).toEqual([{ type: "text", text: "hello" }]);

  const fakePath = join(directory, "fake.png");
  writeFileSync(fakePath, "hello");
  expect(readFile({ path: fakePath }).content[0].text.startsWith("error not_image:")).toBe(true);
});

test("read_file resizes an image that would exceed the tool result budget", () => {
  const directory = tempDir();
  const imagePath = join(directory, "noise.png");
  const png = noisyPng(700, 500);
  writeFileSync(imagePath, png);
  expect(png.toString("base64").length).toBeGreaterThan(IMAGE_BASE64_CHAR_LIMIT);
  const before = statSync(imagePath).size;
  const image = readFile({ path: imagePath });
  expect(statSync(imagePath).size).toBe(before);
  expect(image.isError).toBeUndefined();
  const block = image.content.find((item) => item.type === "image");
  expect(block?.type).toBe("image");
  if (block?.type !== "image") return;
  expect(block.mimeType === "image/png" || block.mimeType === "image/jpeg").toBe(true);
  expect(block.data.length).toBeGreaterThan(OUTPUT_CHAR_LIMIT);
  expect(block.data.length).toBeLessThanOrEqual(IMAGE_BASE64_CHAR_LIMIT);
  expect(block.data).not.toContain("[truncated]");
  expect(image.content[0].text).toContain(imagePath);
  expect(image.content[0].text).toContain("700×500");
  expect(image.content[0].text).toContain("preview");
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

test("glob skips node_modules and dotfiles unless the pattern names them", () => {
  const directory = tempDir();
  writeFileSync(join(directory, "a.ts"), "");
  writeFileSync(join(directory, ".hidden.ts"), "");
  mkdirSync(join(directory, "node_modules"));
  writeFileSync(join(directory, "node_modules", "pkg.ts"), "");
  const found = findFiles({ pattern: "*.ts", path: directory });
  expect(found.content[0].text).toContain(join(directory, "a.ts"));
  expect(found.content[0].text).not.toContain(".hidden.ts");
  expect(found.content[0].text).not.toContain("pkg.ts");
  const named = findFiles({ pattern: ".hidden.ts", path: directory });
  expect(named.content[0].text).toContain(join(directory, ".hidden.ts"));
});

test("grep skips a binary file and keeps a text hit", () => {
  const directory = tempDir();
  writeFileSync(join(directory, "bin.dat"), Buffer.from([0, 104, 105, 116]));
  writeFileSync(join(directory, "note.txt"), "hit");
  const result = searchFiles({ pattern: "hit", path: directory });
  expect(result.content[0].text).toContain("note.txt");
  expect(result.content[0].text).not.toContain("bin.dat");
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
  expect(isBlockedAddress("0.0.0.0")).toBe(true);
  expect(isBlockedAddress("fe80::1")).toBe(true);
  expect(isBlockedAddress("ff02::1")).toBe(true);
  expect(isBlockedAddress("::ffff:0:127.0.0.1")).toBe(true);
  expect(isBlockedAddress("::127.0.0.1")).toBe(true);
  expect(isBlockedAddress("8.8.8.8")).toBe(false);
  const blocked = await fetchUrl(
    { url: "http://127.0.0.1/" },
    { fetch: async () => { throw new Error("fetched private"); } },
  );
  expect(blocked.content[0].text.startsWith("error fetch_blocked:")).toBe(true);
  const seen: { href: string; host: string | null }[] = [];
  const missing = await fetchUrl(
    { url: "https://example.test/missing" },
    {
      lookup: async () => ["8.8.8.8"],
      fetch: async (input, init) => {
        seen.push(calledFetch(input, init));
        return new Response("gone", { status: 404 });
      },
    },
  );
  expect(missing.isError).toBeUndefined();
  expect(missing.content[0].text).toContain("status 404");
  expect(seen[0]?.href).toBe("https://8.8.8.8/missing");
  expect(seen[0]?.host).toBe("example.test");
  const okSeen: { href: string; host: string | null }[] = [];
  const okResult = await fetchUrl(
    { url: "https://example.com/hello" },
    {
      lookup: async () => ["8.8.8.8"],
      fetch: async (input, init) => {
        okSeen.push(calledFetch(input, init));
        return new Response("hello", { status: 200 });
      },
    },
  );
  expect(okResult.content[0].text).toContain("status 200");
  expect(okResult.content[0].text).toContain("hello");
  expect(okSeen[0]?.href).toBe("https://8.8.8.8/hello");
  expect(okSeen[0]?.host).toBe("example.com");
  const rebound = await fetchUrl(
    { url: "https://example.com/go" },
    {
      lookup: async (hostname) => (hostname === "127.0.0.1" ? ["127.0.0.1"] : ["8.8.8.8"]),
      fetch: async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }),
    },
  );
  expect(rebound.content[0].text.startsWith("error fetch_blocked:")).toBe(true);
  const failed = await fetchUrl(
    { url: "https://missing.example/" },
    { lookup: async () => { throw new Error("no dns"); } },
  );
  expect(failed.content[0].text.startsWith("error fetch_failed:")).toBe(true);
});

function calledFetch(input: string | URL | Request, init?: RequestInit): { href: string; host: string | null } {
  const href = input instanceof URL ? input.href : input instanceof Request ? input.url : input;
  const host = new Headers(input instanceof Request ? input.headers : init?.headers).get("host");
  return { href, host };
}

test("tools/list exposes seven host tools and instructions", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db, { instructions: readServerInstructions() });
  const key = createApiKey(db, "test").secret;
  const listed = await postMcp(app, "tools/list", undefined, key);
  const names = listed.body.result?.tools?.map((tool) => tool.name) ?? [];
  expect(names).toEqual([
    "read_file",
    "write_file",
    "edit_file",
    "glob",
    "grep",
    "shell",
    "web_fetch",
    "memory_search",
    "memory_save",
    "memory_forget",
    "skill_list",
    "skill_read",
    "skill_save",
    "skill_delete",
  ]);
  const read = listed.body.result?.tools?.find((tool) => tool.name === "read_file");
  const shell = listed.body.result?.tools?.find((tool) => tool.name === "shell");
  expect(read?.annotations?.readOnlyHint).toBe(true);
  expect(shell?.annotations?.readOnlyHint).toBe(false);
  expect(shell?.annotations?.destructiveHint).toBe(true);
  const initialized = await postMcp(app, "initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "test", version: "0" },
  }, key);
  expect(initialized.body.result?.serverInfo?.instructions).toBe(readServerInstructions());
  expect(assertInstructions(readServerInstructions()).length).toBeGreaterThan(0);
  expect(assertInstructions(readServerInstructions()).length).toBeLessThanOrEqual(512);
});
