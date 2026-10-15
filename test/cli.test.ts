import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db/database.ts";
import { newSecret, readConfig, saveConfig } from "../src/cli/config.ts";
import { clearInstance, controlHandler, readInstance, requestControl, writeInstance } from "../src/cli/control.ts";
import { completeSetup, operatorReady } from "../src/cli/setup.ts";
import { DEFAULT_CLI_PORT, isPortAvailable, selectFirstRunPort } from "../src/cli/ports.ts";

let directory: string;
let previousHome: string | undefined;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "agent-mcp-cli-"));
  previousHome = process.env.AGENT_MCP_HOME;
  process.env.AGENT_MCP_HOME = directory;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.AGENT_MCP_HOME;
  else process.env.AGENT_MCP_HOME = previousHome;
  rmSync(directory, { recursive: true, force: true });
});

test("setup persists a usable operator before any server can bind its port", async () => {
  const occupied = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("occupied") });
  const config = { email: "setup@example.com", secret: newSecret(), port: occupied.port! };
  try {
    await completeSetup(config, "setup-password-123");
    expect(readConfig()).toEqual(config);
    expect(operatorReady(config)).toBe(true);
    expect(readFileSync(join(directory, "config.json"), "utf8")).not.toContain("setup-password-123");
    if (process.platform !== "win32") {
      expect(statSync(join(directory, "config.json")).mode & 0o777).toBe(0o600);
      expect(statSync(directory).mode & 0o777).toBe(0o700);
    }
  } finally {
    occupied.stop(true);
  }

  const db = openDatabase(join(directory, "agent.sqlite"));
  try {
    const app = await createApp(db, {
      secret: config.secret,
      baseURL: `http://127.0.0.1:${config.port}`,
      port: config.port,
      operator: { email: config.email, password: "" },
    });
    const login = await app.request("/api/login", {
      method: "POST",
      headers: { host: "127.0.0.1", "content-type": "application/json" },
      body: JSON.stringify({ email: config.email, password: "setup-password-123" }),
    });
    expect(login.status).toBe(200);
  } finally {
    db.close();
  }
});

test("setup repairs an existing config whose operator was never created", async () => {
  const config = { email: "setup@example.com", secret: newSecret(), port: 3000 };
  saveConfig(config);
  expect(operatorReady(config)).toBe(false);
  await completeSetup(config, "setup-password-123");
  expect(operatorReady(config)).toBe(true);
  expect(operatorReady({ ...config, email: "other@example.com" })).toBe(false);
});

test("failed operator setup does not mark configuration complete", async () => {
  const config = { email: "setup@example.com", secret: newSecret(), port: 3000 };
  await expect(completeSetup(config, "short")).rejects.toThrow("password_too_short");
  expect(readConfig()).toBeUndefined();
});

async function interactiveSetup() {
  let output = "";
  let emailSent = false;
  let passwordSent = false;
  let confirmationSent = false;
  let autostartDeclined = false;
  const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "../src/cli/main.ts"), "setup"], {
    cwd: directory,
    env: { ...process.env, AGENT_MCP_HOME: directory },
    terminal: {
      cols: 100, rows: 24,
      data(terminal, bytes) {
        output += new TextDecoder().decode(bytes);
        if (!emailSent && output.includes("Email operator:")) {
          emailSent = true;
          terminal.write("setup@example.com\n");
        }
        if (!passwordSent && output.includes("Password operator")) {
          passwordSent = true;
          terminal.write("setup-password-123\r");
        }
        if (!confirmationSent && output.includes("Konfirmasi password")) {
          confirmationSent = true;
          terminal.write("setup-password-123\r");
        }
        if (!autostartDeclined && output.includes("Jalankan otomatis saat login komputer")) {
          autostartDeclined = true;
          terminal.write("n\r");
        }
      },
    },
  });
  const timeout = setTimeout(() => child.kill(), 5000);
  try {
    expect(await child.exited, output).toBe(0);
    expect(passwordSent).toBe(true);
    expect(confirmationSent).toBe(true);
    expect(autostartDeclined).toBe(true);
    expect(output).not.toContain("setup-password-123");
  } finally {
    clearTimeout(timeout);
    child.terminal?.close();
  }
}

test("interactive setup waits for a hidden password and completes operator creation", async () => {
  await interactiveSetup();
  const config = readConfig();
  expect(config?.email).toBe("setup@example.com");
  expect(operatorReady(config!)).toBe(true);
});

test("interactive setup repairs a saved config with no operator", async () => {
  const config = { email: "setup@example.com", secret: newSecret(), port: 3000 };
  saveConfig(config);
  await interactiveSetup();
  expect(readConfig()).toEqual(config);
  expect(operatorReady(config)).toBe(true);
});

test("new installs prefer a quiet high port and recover from collisions", async () => {
  const occupied = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("occupied") });
  try {
    const fallback = await selectFirstRunPort(occupied.port!);
    expect(fallback).toBeGreaterThanOrEqual(1024);
    expect(fallback).not.toBe(occupied.port);
    expect(await isPortAvailable(occupied.port!)).toBe(false);
    expect(await isPortAvailable(fallback)).toBe(true);
    expect(DEFAULT_CLI_PORT).toBe(47831);
  } finally { occupied.stop(true); }
});

test("config commands never reveal secrets and validate port changes", async () => {
  const config = { email: "setup@example.com", secret: newSecret(), port: 3000 };
  await completeSetup(config, "setup-password-123");
  const initial = openDatabase(join(directory, "agent.sqlite"));
  await createApp(initial, { secret: config.secret, baseURL: "http://127.0.0.1:3000", port: config.port, operator: { email: config.email, password: "" } });
  initial.close();
  const root = join(import.meta.dir, "../src/cli/main.ts");
  const run = async (...args: string[]) => {
    const child = Bun.spawn([process.execPath, "--no-env-file", root, ...args], {
      cwd: directory,
      env: { ...process.env, AGENT_MCP_HOME: directory },
      stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    return { stdout, stderr, code };
  };
  const shown = await run("config", "show");
  expect(shown.code).toBe(0);
  expect(shown.stdout).toContain("3000");
  expect(shown.stdout).not.toContain(config.secret);
  const invalid = await run("config", "set", "port", "22");
  expect(invalid.code).toBe(1);
  expect(readConfig()?.port).toBe(3000);
  const changed = await run("config", "set", "port", "auto");
  expect(changed.code).toBe(0);
  expect(readConfig()?.port).toBeGreaterThan(1023);
  expect(readConfig()?.secret).toBe(config.secret);
  const db = openDatabase(join(directory, "agent.sqlite"));
  try {
    const row = db.query("SELECT public_base_url FROM settings WHERE id = 1").get() as { public_base_url: string };
    expect(row.public_base_url).toBe(`http://127.0.0.1:${readConfig()?.port}`);
  } finally { db.close(); }
});

test("password reset prompts twice without leaking the password", async () => {
  const config = { email: "setup@example.com", secret: newSecret(), port: 3000 };
  await completeSetup(config, "setup-password-123");
  let output = "";
  let first = false;
  let second = false;
  const child = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "../src/cli/main.ts"), "auth", "reset-password"], {
    cwd: directory,
    env: { ...process.env, AGENT_MCP_HOME: directory },
    terminal: {
      cols: 100, rows: 24,
      data(terminal, bytes) {
        output += new TextDecoder().decode(bytes);
        if (!first && output.includes("Password baru")) {
          first = true;
          terminal.write("new-operator-password-123\r");
        }
        if (!second && output.includes("Konfirmasi password baru")) {
          second = true;
          terminal.write("new-operator-password-123\r");
        }
      },
    },
  });
  const timeout = setTimeout(() => child.kill(), 5000);
  try {
    expect(await child.exited, output).toBe(0);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(output).not.toContain("new-operator-password-123");
  } finally {
    clearTimeout(timeout);
    child.terminal?.close();
  }
  const db = openDatabase(join(directory, "agent.sqlite"));
  try {
    const app = await createApp(db, {
      secret: config.secret,
      port: config.port,
      operator: { email: config.email, password: "" },
    });
    const login = (password: string) => app.request("/api/login", {
      method: "POST",
      headers: { host: "127.0.0.1", "content-type": "application/json" },
      body: JSON.stringify({ email: config.email, password }),
    });
    expect((await login("setup-password-123")).status).not.toBe(200);
    expect((await login("new-operator-password-123")).status).toBe(200);
  } finally { db.close(); }
});

test("stale process records cannot stop a different server or reused PID", async () => {
  const instance = { pid: process.pid, token: newSecret() };
  let shutdowns = 0;
  const control = controlHandler(instance, () => { shutdowns++; });
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch: (request) => control(request) ?? Response.json({ data: { ok: true } }),
  });
  const config = { email: "setup@example.com", secret: newSecret(), port: server.port! };
  try {
    writeFileSync(join(directory, "server.pid"), String(process.pid));
    expect(readInstance()).toBeUndefined();
    const stale = { pid: process.pid, token: newSecret() };
    writeInstance(stale);
    expect(await requestControl(config, stale, "POST")).toBe(false);
    expect(await requestControl(config, { ...instance, pid: process.pid + 1 }, "POST")).toBe(false);
    const unauthenticated = await fetch(`http://127.0.0.1:${server.port}/__agent-mcp/control`, { method: "POST" });
    expect(unauthenticated.status).toBe(401);
    await Bun.sleep(30);
    expect(shutdowns).toBe(0);

    writeInstance(instance);
    clearInstance(stale);
    expect(readInstance()).toEqual(instance);
    expect(await requestControl(config, instance, "GET")).toBe(true);
    expect(await requestControl(config, instance, "POST")).toBe(true);
    await Bun.sleep(30);
    expect(shutdowns).toBe(1);
    clearInstance(instance);
    expect(readInstance()).toBeUndefined();
  } finally {
    server.stop(true);
  }
});
