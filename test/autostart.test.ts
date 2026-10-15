import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import {
  autostartPaths, autostartStatus, desktopEntry, disableAutostart, enableAutostart,
  isStandaloneBinary, macLaunchAgent, systemdService, windowsStartupScript,
} from "../src/cli/autostart.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function testRoot(): string {
  const base = join(import.meta.dir, "../.cache");
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, "autostart-"));
  roots.push(dir);
  return dir;
}

test("autostart is disabled by default and does not use administrator locations", async () => {
  const root = testRoot();
  const paths = autostartPaths("darwin", root);
  expect(paths.primary).toBe(join(root, "Library/LaunchAgents/com.agent-mcp.server.plist"));
  const status = await autostartStatus("darwin", root);
  expect(status.enabled).toBe(false);
  expect(status.provider).toBe("launchd");
  expect(autostartPaths("win32").primary).toStartWith("HKCU");
  expect(autostartPaths("linux", root).primary).toBe(join(root, ".config/systemd/user/agent-mcp.service"));
  expect(autostartPaths("linux", root).fallback).toBe(join(root, ".config/autostart/agent-mcp.desktop"));
});

test("generated launch files escape paths, inherit the correct app data, and restart only on crashes", () => {
  const exe = '/tmp/App & Tools/agent-mcp';
  const appHome = '/tmp/User & Apps/agent-mcp';
  const plist = macLaunchAgent(exe, appHome);
  expect(plist).toContain("/tmp/App &amp; Tools/agent-mcp");
  expect(plist).toContain("AGENT_MCP_HOME");
  expect(plist).toContain("SuccessfulExit");
  expect(plist).toContain("<false/>");
  expect(plist).toContain("--foreground");
  const service = systemdService(exe, appHome);
  expect(service).toContain('ExecStart="/tmp/App & Tools/agent-mcp" --foreground');
  expect(service).toContain('Environment=AGENT_MCP_HOME="/tmp/User & Apps/agent-mcp"');
  expect(service).toContain("Restart=on-failure");
  expect(service).toContain("WantedBy=default.target");
  const desktop = desktopEntry(exe, appHome);
  expect(desktop).toContain("Terminal=false");
  expect(desktop).toContain("AGENT_MCP_HOME=");
  expect(desktop).toContain("--foreground");
  const windows = windowsStartupScript("C:\\\\Apps\\\\Agent MCP\\\\agent-mcp.exe", "C:\\\\Users\\\\O\'Brien\\\\AppData");
  expect(windows).toContain("Start-Process");
  expect(windows).toContain("-WindowStyle Hidden");
  expect(windows).toContain("O\'\'Brien");
  expect(windows).toContain("AGENT_MCP_HOME");
  expect(windows).toContain("ExitCode -eq 0");
});

test("macOS autostart enable/status/disable only changes a controlled user LaunchAgent", async () => {
  const root = testRoot();
  const exe = join(root, "agent-mcp");
  writeFileSync(exe, "compiled-exe-fixture", { mode: 0o755 });
  chmodSync(exe, 0o755);
  expect(isStandaloneBinary(exe)).toBe(true);
  expect(isStandaloneBinary(process.execPath)).toBe(false);
  const appHome = join(root, "data");
  const on = await enableAutostart(exe, "darwin", root, appHome);
  expect(on.enabled).toBe(true);
  const contents = readFileSync(on.path, "utf8");
  expect(contents).toContain(exe);
  expect(contents).toContain(appHome);
  expect(existsSync(on.path)).toBe(true);
  const off = await disableAutostart("darwin", root);
  expect(off.enabled).toBe(false);
  expect(existsSync(on.path)).toBe(false);
});

test("autostart refuses overwriting another app's launch file and refuses source Bun", async () => {
  const root = testRoot();
  const exe = join(root, "agent-mcp");
  writeFileSync(exe, "binary");
  const plist = autostartPaths("darwin", root).primary;
  mkdirSync(join(root, "Library/LaunchAgents"), { recursive: true });
  writeFileSync(plist, "<plist>unrelated application</plist>");
  await expect(enableAutostart(exe, "darwin", root, join(root, "data"))).rejects.toThrow("autostart_file_not_managed");
  expect(readFileSync(plist, "utf8")).toBe("<plist>unrelated application</plist>");
  await expect(enableAutostart(process.execPath, "darwin", root, join(root, "data"))).rejects.toThrow("autostart_requires_standalone_binary");
  await disableAutostart("darwin", root);
  expect(existsSync(plist)).toBe(true);
});
