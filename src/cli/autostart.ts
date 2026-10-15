import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { dataDirectory } from "./paths.ts";

const run = promisify(execFile);
const macLabel = "com.agent-mcp.server";
const linuxUnit = "agent-mcp.service";
const windowsName = "Agent MCP";
const windowsKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const marker = "Agent MCP managed autostart";
export type AutostartPlatform = "darwin" | "win32" | "linux";
export type AutostartStatus = { enabled: boolean; supported: boolean; provider: string; path: string };

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function systemd(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("invalid_autostart_path");
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%") + '"';
}
function desktop(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("invalid_autostart_path");
  return '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/\`/g, "\\`") + '"';
}
function windowsQuoted(value: string): string {
  if (/[\r\n\0"]/g.test(value)) throw new Error("invalid_autostart_path");
  return '"' + value + '"';
}
function powershellLiteral(value: string): string {
  if (/[\r\n\0]/.test(value)) throw new Error("invalid_autostart_path");
  return "'" + value.replace(/'/g, "''") + "'";
}
export function windowsStartupScript(executable: string, home: string): string {
  return `# ${marker}\n$ErrorActionPreference = 'Stop'\n$env:AGENT_MCP_HOME = ${powershellLiteral(home)}\nwhile ($true) {\n  $process = Start-Process -FilePath ${powershellLiteral(executable)} -ArgumentList '--foreground' -WindowStyle Hidden -PassThru -RedirectStandardOutput ${powershellLiteral(join(home, "server.log"))} -RedirectStandardError ${powershellLiteral(join(home, "server-error.log"))}\n  $process.WaitForExit()\n  if ($process.ExitCode -eq 0) { break }\n  Start-Sleep -Seconds 10\n}\n`;
}
function managedFile(path: string): boolean {
  return existsSync(path) && readFileSync(path, "utf8").includes(marker);
}
function writeManagedFile(path: string, contents: string): void {
  if (existsSync(path) && !managedFile(path)) throw new Error("autostart_file_not_managed");
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, contents, { mode: 0o600 });
}
export function isStandaloneBinary(executable = process.execPath): boolean {
  return /^(agent-mcp|agent-mcp\.exe)$/i.test(basename(executable)) && isAbsolute(executable) && existsSync(executable);
}

export function autostartPaths(platform: AutostartPlatform = process.platform as AutostartPlatform, home = homedir()) {
  if (platform === "darwin") return {
    primary: join(home, "Library/LaunchAgents", macLabel + ".plist"), fallback: "",
    provider: "launchd",
  };
  if (platform === "win32") return { primary: windowsKey, fallback: "", provider: "Windows Run" };
  if (platform === "linux") return {
    primary: join(home, ".config/systemd/user", linuxUnit),
    fallback: join(home, ".config/autostart/agent-mcp.desktop"),
    provider: "systemd --user",
  };
  throw new Error("unsupported_autostart_platform");
}
export function macLaunchAgent(executable: string, home: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- ${marker} -->
<plist version="1.0"><dict>
<key>Label</key><string>${macLabel}</string>
<key>ProgramArguments</key><array><string>${xml(executable)}</string><string>--foreground</string></array>
<key>EnvironmentVariables</key><dict><key>AGENT_MCP_HOME</key><string>${xml(home)}</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>ThrottleInterval</key><integer>10</integer>
<key>StandardOutPath</key><string>${xml(join(home, "server.log"))}</string>
<key>StandardErrorPath</key><string>${xml(join(home, "server.log"))}</string>
</dict></plist>
`;
}
export function systemdService(executable: string, home: string): string {
  return `# ${marker}
[Unit]
Description=Agent MCP server
After=network.target

[Service]
Type=simple
ExecStart=${systemd(executable)} --foreground
Environment=AGENT_MCP_HOME=${systemd(home)}
Restart=on-failure
RestartSec=10
WorkingDirectory=${systemd(home)}

[Install]
WantedBy=default.target
`;
}
export function desktopEntry(executable: string, home: string): string {
  return `[Desktop Entry]
# ${marker}
Type=Application
Name=Agent MCP
Comment=Run Agent MCP at login
Exec=env AGENT_MCP_HOME=${desktop(home)} ${desktop(executable)} --foreground
Terminal=false
X-GNOME-Autostart-enabled=true
`;
}
async function systemdAvailable(): Promise<boolean> {
  try {
    const { stdout } = await run("systemctl", ["--user", "show-environment"], { timeout: 3500 });
    return typeof stdout === "string";
  } catch { return false; }
}
async function runSystemctl(args: string[]): Promise<void> {
  try { await run("systemctl", ["--user", ...args], { timeout: 10000 }); }
  catch (error) {
    throw new Error(`systemd_autostart_failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
async function windowsEntry(): Promise<string | undefined> {
  try {
    const { stdout } = await run("reg", ["query", windowsKey, "/v", windowsName], { timeout: 5000 });
    return stdout.match(/Agent MCP\s+REG_SZ\s+(.+)/i)?.[1]?.trim();
  } catch { return undefined; }
}
function isManagedWindowsEntry(value: string | undefined): boolean {
  return !!value && /powershell\.exe/i.test(value) && /autostart\.ps1/i.test(value);
}
export async function autostartStatus(
  platform: AutostartPlatform = process.platform as AutostartPlatform,
  home = homedir(),
): Promise<AutostartStatus> {
  const paths = autostartPaths(platform, home);
  if (platform === "win32") return {
    enabled: isManagedWindowsEntry(await windowsEntry()), supported: true, provider: paths.provider, path: paths.primary,
  };
  if (platform === "linux") {
    const primary = managedFile(paths.primary);
    const fallback = managedFile(paths.fallback);
    return {
      enabled: primary || fallback, supported: true,
      provider: primary ? "systemd --user" : fallback ? "XDG Autostart" : paths.provider,
      path: primary ? paths.primary : fallback ? paths.fallback : paths.primary,
    };
  }
  return {
    enabled: managedFile(paths.primary), supported: true, provider: paths.provider, path: paths.primary,
  };
}

export async function enableAutostart(
  executable = process.execPath,
  platform: AutostartPlatform = process.platform as AutostartPlatform,
  home = homedir(),
  appHome = resolve(dataDirectory()),
): Promise<AutostartStatus> {
  if (!isStandaloneBinary(executable)) throw new Error("autostart_requires_standalone_binary");
  const paths = autostartPaths(platform, home);
  if (platform === "darwin") {
    mkdirSync(appHome, { recursive: true, mode: 0o700 });
    writeManagedFile(paths.primary, macLaunchAgent(executable, appHome));
  } else if (platform === "linux") {
    if (await systemdAvailable()) {
      mkdirSync(appHome, { recursive: true, mode: 0o700 });
      writeManagedFile(paths.primary, systemdService(executable, appHome));
      await runSystemctl(["daemon-reload"]);
      await runSystemctl(["enable", linuxUnit]); // Activate at next login, not immediately.
      if (managedFile(paths.fallback)) unlinkSync(paths.fallback);
    } else {
      if (managedFile(paths.primary)) throw new Error("autostart_user_systemd_unavailable");
      writeManagedFile(paths.fallback, desktopEntry(executable, appHome));
    }
  } else if (platform === "win32") {
    // PowerShell starts the binary with no visible console, retaining the configured home.
    const current = await windowsEntry();
    if (current && !isManagedWindowsEntry(current)) throw new Error("autostart_entry_not_managed");
    mkdirSync(appHome, { recursive: true, mode: 0o700 });
    const script = join(appHome, "autostart.ps1");
    writeManagedFile(script, windowsStartupScript(executable, appHome));
    const action = `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File ${windowsQuoted(script)}`;
    if (action.length > 260) throw new Error("autostart_path_too_long");
    await run("reg", ["add", windowsKey, "/v", windowsName, "/t", "REG_SZ",
      "/d", action, "/f"], { timeout: 10000 });
  }
  return autostartStatus(platform, home);
}
export async function disableAutostart(
  platform: AutostartPlatform = process.platform as AutostartPlatform,
  home = homedir(),
): Promise<AutostartStatus> {
  const paths = autostartPaths(platform, home);
  if (platform === "darwin") {
    if (managedFile(paths.primary)) unlinkSync(paths.primary);
  } else if (platform === "linux") {
    if (managedFile(paths.primary)) {
      await runSystemctl(["disable", linuxUnit]);
      unlinkSync(paths.primary);
      await runSystemctl(["daemon-reload"]);
    }
    if (managedFile(paths.fallback)) unlinkSync(paths.fallback);
  } else if (platform === "win32" && isManagedWindowsEntry(await windowsEntry())) {
    await run("reg", ["delete", windowsKey, "/v", windowsName, "/f"], { timeout: 10000 });
  }
  return autostartStatus(platform, home);
}
