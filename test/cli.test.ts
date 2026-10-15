import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createApp } from "../src/app.ts";
import { openDatabase } from "../src/db/database.ts";
import { newSecret, readConfig, saveConfig } from "../src/cli/config.ts";
import { clearInstance, controlHandler, readInstance, requestControl, writeInstance } from "../src/cli/control.ts";
import { completeSetup, operatorReady } from "../src/cli/setup.ts";

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
      },
    },
  });
  const timeout = setTimeout(() => child.kill(), 5000);
  try {
    expect(await child.exited, output).toBe(0);
    expect(passwordSent).toBe(true);
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
