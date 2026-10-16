import { expect, test } from "bun:test";
import { openDatabase } from "../src/db/database.ts";
import { CuaBridge, boundedDriverEnvironment } from "../src/computer/bridge.ts";
import { reserveSandbox, expiredSandboxes } from "../src/computer/ownership.ts";
import { sandboxOwned, ownSandbox, forgetSandbox } from "../src/computer/ownership.ts";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computerSettings, updateComputerSettings } from "../src/computer/config.ts";
import { validateHostAction, validateSandboxAction } from "../src/computer/tools.ts";
import { createApiKey } from "../src/auth/keys.ts";
import { readServerInstructions } from "../src/mcp/instructions.ts";
import { testApp } from "./harness.ts";
import { postMcp } from "./mcp-client.ts";

test("computer use permissions fail closed and persist independently", () => {
  const db = openDatabase(":memory:");
  expect(computerSettings(db)).toEqual({
    driver_observe: false, driver_control: false, sandbox_observe: false, sandbox_manage: false,
  });
  expect(() => updateComputerSettings(db, { driver_control: true })).toThrow();
  expect(() => updateComputerSettings(db, { sandbox_manage: true })).toThrow();
  expect(() => updateComputerSettings(db, { unknown: true })).toThrow();
  expect(() => updateComputerSettings(db, { driver_observe: "yes" })).toThrow();
  const allowed = updateComputerSettings(db, { driver_observe: true, driver_control: true });
  expect(allowed.driver_control).toBe(true);
  expect(computerSettings(db).driver_observe).toBe(true);
  expect(() => updateComputerSettings(db, { driver_observe: false })).toThrow();
  db.close();
});

test("host control validates exact windows, prevents desktop-wide access and enforces launch allowlist", () => {
  expect(validateHostAction("get_window_state", { pid: 22, window_id: 12, include_screenshot: false })).toBeNull();
  expect(validateHostAction("get_window_state", { window_id: 12 })).not.toBeNull();
  expect(validateHostAction("list_windows", {})).not.toBeNull();
  expect(validateHostAction("list_windows", { pid: 22 })).toBeNull();
  expect(validateHostAction("list_windows", { pid: 22, scope: "desktop" })).not.toBeNull();
  expect(validateHostAction("click", { target: { kind: "desktop", display_id: "primary" }, x: 1, y: 2 })).not.toBeNull();
  expect(validateHostAction("click", { target: { kind: "window", pid: 22, window_id: 12 }, x: 1, y: 2 })).toBeNull();
  expect(validateHostAction("type_text", { target: { kind: "window", pid: 22, window_id: 12 }, text: "Hi", delivery_mode: "foreground" })).not.toBeNull();
  expect(validateHostAction("type_text", { target: { kind: "window", pid: 22, window_id: 12 }, text: "x".repeat(4001) })).not.toBeNull();
  expect(validateHostAction("click", { target: { kind: "window", pid: 22, window_id: 12 }, x: 1, y: 2, debug_image_out: "/tmp/a" })).not.toBeNull();
  expect(validateHostAction("launch_app", { bundle_id: "com.unapproved.App" })).not.toBeNull();
});

test("sandbox management restricts destructive actions to explicit local targets", () => {
  expect(validateSandboxAction("sandbox_list", { location: "local" })).toBeNull();
  expect(validateSandboxAction("sandbox_list", { location: "cloud" })).toContain("local");
  expect(validateSandboxAction("sandbox_get", { name: "cloud:demo" })).toContain("local");
  expect(validateSandboxAction("sandbox_delete", { name: "local:demo" })).toBeNull();
  expect(validateSandboxAction("sandbox_create", { name: "dev", on: "cloud" })).toContain("local");
  expect(validateSandboxAction("sandbox_create", { name: "dev", env: { SECRET: "x" } })).toContain("not allowed");
  expect(validateSandboxAction("computer_click", { sandbox: "cloud:dev", x: 10, y: 10 })).toContain("local");
  expect(validateSandboxAction("computer_click", { sandbox: "local:demo", x: 10, y: 20, shell: "echo x" })).toContain("Unsupported");
  expect(validateSandboxAction("computer_click", { sandbox: "local:demo", x: 10, y: 20 })).toBeNull();
  expect(validateSandboxAction("computer_scroll", { sandbox: "local:demo", direction: "sideways" })).toContain("Invalid");
  expect(validateSandboxAction("computer_type", { sandbox: "local:demo", text: "x".repeat(4001) })).toContain("4000");
});

test("MCP exposes computer tools but denies actions until operator opts in; never audits their inputs", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db, { instructions: readServerInstructions() });
  const key = createApiKey(db, "computer-test").secret;
  const listed = await postMcp(app, "tools/list", undefined, key);
  for (const name of ["computer_status", "computer_driver", "computer_sandbox"]) {
    expect(listed.body.result?.tools?.some((item) => item.name === name)).toBe(true);
  }
  const disabled = await postMcp(app, "tools/call", { name: "computer_driver", arguments: { action: "type_text", parameters: { text: "secret typed password" } } }, key);
  expect(disabled.body.result?.isError).toBe(true);
  expect(disabled.body.result?.content?.[0]?.text).toContain("computer_disabled");
  const row = db.query("SELECT arguments_json, result_text FROM tool_calls WHERE tool_name = 'computer_driver' ORDER BY started_at DESC LIMIT 1").get() as { arguments_json: string; result_text: string };
  expect(row.arguments_json).not.toContain("secret typed password");
  expect(row.result_text).not.toContain("secret typed password");
  const sandboxDisabled = await postMcp(app, "tools/call", { name: "computer_sandbox", arguments: { action: "sandbox_list" } }, key);
  expect(sandboxDisabled.body.result?.isError).toBe(true);
  db.close();
});

test("sandbox ownership is isolated across authenticated principals", () => {
  const db = openDatabase(":memory:");
  ownSandbox(db, "api_key:alpha", "local:demo");
  expect(sandboxOwned(db, "api_key:alpha", "local:demo")).toBe(true);
  expect(sandboxOwned(db, "api_key:beta", "local:demo")).toBe(false);
  forgetSandbox(db, "api_key:beta", "local:demo");
  expect(sandboxOwned(db, "api_key:alpha", "local:demo")).toBe(true);
  forgetSandbox(db, "api_key:alpha", "local:demo");
  expect(sandboxOwned(db, "api_key:alpha", "local:demo")).toBe(false);
  db.close();
});

test("sandbox quotas are enforced and expired leases are discoverable", () => {
  const db = openDatabase(":memory:");
  expect(reserveSandbox(db, "one", "local:a")).toBeNull();
  expect(reserveSandbox(db, "one", "local:b")).toBe("sandbox_quota_exceeded");
  expect(reserveSandbox(db, "two", "local:b")).toBeNull();
  expect(reserveSandbox(db, "three", "local:c")).toBe("sandbox_quota_exceeded");
  db.query("UPDATE computer_sandbox_owners SET created_at = ? WHERE name = ?").run(
    new Date(Date.now() - 3_600_001).toISOString(), "local:a",
  );
  expect(expiredSandboxes(db).some((entry) => entry.name === "local:a")).toBe(true);
  db.close();
});

test("bounded driver requires a trusted policy and allowed apps", () => {
  const dir = mkdtempSync(join(tmpdir(), "cua-policy-"));
  const manifest = join(dir, "policy.yaml");
  const names = ["CUA_DRIVER_PERMISSION_MODE", "CUA_DRIVER_CAPABILITY_MANIFEST_FILE", "CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED", "CUA_DRIVER_ALLOWED_APPS"];
  const previous = names.map((name) => process.env[name]);
  const yaml = ["version: 3", "expires_after: 1h", "idle_timeout: 10m", "allow:", "  tools:", "    - launch_app", "resources:", "  apps:", "    - bundle_id: com.example.App", "  desktop:", "    display: false"].join("\n");
  try {
    process.env.CUA_DRIVER_PERMISSION_MODE = "bounded";
    process.env.CUA_DRIVER_CAPABILITY_MANIFEST_FILE = manifest;
    process.env.CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED = "1";
    process.env.CUA_DRIVER_ALLOWED_APPS = "com.example.App";
    writeFileSync(manifest, yaml);
    expect(boundedDriverEnvironment().CUA_DRIVER_PERMISSION_MODE).toBe("bounded");
    writeFileSync(manifest, yaml.replace("display: false", "display: true"));
    expect(() => boundedDriverEnvironment()).toThrow();
  } finally {
    names.forEach((name, i) => {
      if (previous[i] === undefined) delete process.env[name];
      else process.env[name] = previous[i];
    });
    rmSync(dir, { recursive: true, force: true });
  }
});

test("stdio bridge negotiates MCP, discovers tools, and preserves screenshot images", async () => {
  const folder = mkdtempSync(join(tmpdir(), "agent-cua-mock-"));
  const binary = join(folder, "cua-driver");
  writeFileSync(binary, `#!/bin/sh\nexec "${process.execPath}" "${join(import.meta.dir, "mock-cua.ts")}" "$@"\n`);
  chmodSync(binary, 0o700);
  const oldEnv = Object.fromEntries(["CUA_DRIVER_BIN", "CUA_DRIVER_PERMISSION_MODE", "CUA_DRIVER_CAPABILITY_MANIFEST_FILE", "CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED", "CUA_DRIVER_ALLOWED_APPS"].map((name) => [name, process.env[name]]));
  const manifest = join(folder, "capabilities.yaml");
  writeFileSync(manifest, [
    "version: 3", "expires_after: 1h", "idle_timeout: 10m",
    "allow:", "  tools:", "    - launch_app", "    - list_windows", "    - get_window_state",
    "resources:", "  apps:", "    - bundle_id: com.example.App", "      launch: true", "      windows: all",
    "  desktop:", "    display: false",
  ].join("\n"));
  Object.assign(process.env, {
    CUA_DRIVER_BIN: binary, CUA_DRIVER_PERMISSION_MODE: "bounded",
    CUA_DRIVER_CAPABILITY_MANIFEST_FILE: manifest,
    CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED: "1", CUA_DRIVER_ALLOWED_APPS: "com.example.App",
  });
  const bridge = new CuaBridge();
  try {
    const apps = await bridge.call("driver", "api_key:one", "list_apps", {}, () => true);
    expect(apps.isError).toBeUndefined();
    expect(apps.content[0].text).toContain("Mock Calculator");
    const state = await bridge.call("driver", "api_key:one", "get_window_state", { pid: 12, window_id: 34 }, () => true);
    expect(state.content.some((part) => part.type === "image")).toBe(true);
    const screenshot = await bridge.call("driver", "api_key:one", "computer_screenshot", {}, () => true);
    expect(screenshot.content[0].type).toBe("text");
    expect(screenshot.content[1]?.type).toBe("image");
    const missing = await bridge.call("driver", "api_key:two", "unknown", {}, () => true);
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain("unsupported_tool");
    for (let i = 0; i < 9; i++) {
      const isolated = await bridge.call("driver", "api_key:test:call:" + i, "list_apps", {}, () => true);
      expect(isolated.isError).toBeUndefined();
    }
    const revoked = await bridge.call("driver", "api_key:one", "type_text", { text: "private" }, () => false);
    expect(revoked.isError).toBe(true);
    expect(revoked.content[0].text).toContain("revoked");
  } finally {
    await bridge.dispose();
    for (const [name, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(folder, { recursive: true, force: true });
  }
});
