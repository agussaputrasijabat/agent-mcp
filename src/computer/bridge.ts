import { accessSync, constants, lstatSync, readFileSync } from "node:fs";
import YAML from "yaml";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import type { ToolResult } from "../tools/result.ts";
import { fail, truncate } from "../tools/result.ts";

export type Provider = "driver" | "sandbox";
type Connection = { client: Client; names: Set<string>; lastUse: number };
const SESSION_TTL = 10 * 60_000;
const MAX_CONNECTIONS = 8;
const REQUEST_TIMEOUT = 30_000;

export function executable(provider: Provider): string | null {
  const env = process.env[provider === "driver" ? "CUA_DRIVER_BIN" : "CUA_CLI_BIN"];
  const name = provider === "driver" ? "cua-driver" : "cua";
  const candidates = [
    env, Bun.which(name), join(homedir(), ".local/bin", name),
    ...(provider === "driver" && process.platform === "darwin" ? ["/Applications/CuaDriver.app/Contents/MacOS/cua-driver"] : []),
  ];
  for (const candidate of candidates) {
    if (!candidate || !isAbsolute(candidate)) continue;
    try { accessSync(candidate, constants.X_OK); return candidate; } catch { /* not installed */ }
  }
  return null;
}

export function allowedApps(): Set<string> {
  const values = (process.env.CUA_DRIVER_ALLOWED_APPS ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  // Only bundle IDs or exact absolute executable paths; no fuzzy title or wildcard matching.
  if (!values.length || values.some((v) => v.includes("*") || v.includes("..") || v.includes("\n") ||
    !(/^[a-zA-Z][\w.-]+$/.test(v) || isAbsolute(v)))) return new Set();
  return new Set(values);
}

export function boundedDriverEnvironment(): Record<string, string> {
  const manifest = process.env.CUA_DRIVER_CAPABILITY_MANIFEST_FILE;
  if (process.env.CUA_DRIVER_PERMISSION_MODE !== "bounded" ||
      process.env.CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED !== "1" ||
      !manifest || !isAbsolute(manifest) || allowedApps().size === 0) {
    throw new Error("Cua Driver requires bounded mode, an approved absolute capability manifest and CUA_DRIVER_ALLOWED_APPS");
  }
  const stat = lstatSync(manifest);
  if (!stat.isFile() || (stat.mode & 0o022) !== 0 || (typeof process.getuid === "function" && stat.uid !== process.getuid())) {
    throw new Error("Cua capability manifest must be a regular, non-writable-by-others file owned by the server account");
  }
  accessSync(manifest, constants.R_OK);
  const parsed = YAML.parse(readFileSync(manifest, "utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid Cua manifest");
  const policy = parsed as Record<string, unknown>;
  const resources = policy.resources as Record<string, unknown> | undefined;
  const allow = policy.allow as Record<string, unknown> | undefined;
  const entries = resources?.apps;
  const allowed = allowedApps();
  if (policy.version !== 3 || typeof policy.expires_after !== "string" || typeof policy.idle_timeout !== "string" ||
      !Array.isArray(entries) || entries.length !== allowed.size || !Array.isArray(allow?.tools) ||
      Object.keys(allow).some((key) => key !== "tools") ||
      !Array.isArray(allow.tools) || allow.tools.some((tool) => typeof tool !== "string" ||
        !["start_session", "end_session", "launch_app", "list_apps", "list_windows", "get_window_state",
          "verify_state", "click", "double_click", "right_click", "type_text", "press_key", "hotkey",
          "scroll", "drag"].includes(tool)) ||
      resources?.desktop && (resources.desktop as Record<string, unknown>).display !== false ||
      resources?.files !== undefined || resources?.browser !== undefined ||
      entries.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry) ||
        !(typeof (entry as Record<string, unknown>).bundle_id === "string" && allowed.has((entry as Record<string, unknown>).bundle_id as string) ||
          typeof (entry as Record<string, unknown>).executable === "string" && allowed.has((entry as Record<string, unknown>).executable as string)))) {
    throw new Error("Cua manifest must be v3, deny full-display access, contain only approved tools/apps, and specify expiry and idle timeout");
  }
  return {
    CUA_DRIVER_PERMISSION_MODE: "bounded",
    CUA_DRIVER_CAPABILITY_MANIFEST_FILE: manifest,
    CUA_DRIVER_CAPABILITY_MANIFEST_APPROVED: "1",
    CUA_DRIVER_DANGEROUSLY_BYPASS_APPROVALS: "0",
  };
}

const versionCache = new Map<Provider, { path: string; checkedAt: number; version: string | null }>();
export function computerDiagnostics() {
  return Object.fromEntries((["driver", "sandbox"] as const).map((provider) => {
    const path = executable(provider);
    let version: string | null = null;
    const cached = versionCache.get(provider);
    if (path && cached?.path === path && Date.now() - cached.checkedAt < 60_000) {
      version = cached.version;
    } else if (path) {
      try {
        version = execFileSync(path, ["--version"], { timeout: 2500, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().slice(0, 150);
      } catch { /* invalid runtime */ }
      versionCache.set(provider, { path, checkedAt: Date.now(), version });
    }
    const parsed = provider === "driver" ? /\b(\d+)\.(\d+)\.(\d+)/.exec(version ?? "") : null;
    const compatible = provider === "driver" ? !!parsed && (Number(parsed[1]) > 0 || Number(parsed[2]) >= 28) : !!version;
    let bounded = false;
    if (provider === "driver") {
      try { boundedDriverEnvironment(); bounded = true; } catch { /* unconfigured */ }
    }
    return [provider, { installed: !!path, version, compatible, bounded }];
  }));
}

export class CuaBridge {
  private sessions = new Map<string, Connection>();
  private connections = new Map<string, Promise<Connection>>();
  private serialized = Promise.resolve();
  private generation = 0;
  private readonly sweeper: ReturnType<typeof setInterval>;

  constructor() {
    this.sweeper = setInterval(() => { void this.reapIdle(); }, 60_000);
    this.sweeper.unref();
  }

  private async closeConnection(key: string): Promise<void> {
    const old = this.sessions.get(key);
    this.sessions.delete(key);
    if (old) await old.client.close().catch(() => undefined);
  }

  private async reapIdle(): Promise<void> {
    for (const [key, conn] of this.sessions) {
      if (Date.now() - conn.lastUse >= SESSION_TTL) await this.closeConnection(key);
    }
  }

  async closeAll(): Promise<void> {
    ++this.generation;
    const pending = [...this.connections.values()];
    await Promise.all([...this.sessions.keys()].map((key) => this.closeConnection(key)));
    await Promise.allSettled(pending);
    await Promise.all([...this.sessions.keys()].map((key) => this.closeConnection(key)));
  }

  async dispose(): Promise<void> {
    clearInterval(this.sweeper);
    await this.closeAll();
  }

  private async connect(provider: Provider, identity: string): Promise<Connection> {
    const key = provider + ":" + identity;
    await this.reapIdle();
    const cached = this.sessions.get(key);
    if (cached) { cached.lastUse = Date.now(); return cached; }
    const pending = this.connections.get(key);
    if (pending) return pending;
    if (this.sessions.size + this.connections.size >= MAX_CONNECTIONS) throw new Error("computer_busy");
    const generation = this.generation;
    const promise = (async () => {
      const binary = executable(provider);
      if (!binary) throw new Error(provider + "_not_installed");
      const params = provider === "driver"
        ? ["mcp", "--direct"]
        : ["mcp", "--permissions", "sandbox:list,sandbox:get,sandbox:create,sandbox:start,sandbox:stop,sandbox:delete,images:list,computer:screenshot,computer:click,computer:type,computer:key,computer:scroll"];
      const env = getDefaultEnvironment();
      if (provider === "driver") Object.assign(env, boundedDriverEnvironment());
      const transport = new StdioClientTransport({ command: binary, args: params, env, stderr: "ignore", maxBufferSize: 12 * 1024 * 1024 });
      const client = new Client({ name: "agent-mcp-cua", version: "1.0.0" });
      try {
        await client.connect(transport, { timeout: REQUEST_TIMEOUT });
        const tools = await client.listTools(undefined, { timeout: REQUEST_TIMEOUT });
        if (generation !== this.generation) throw new Error("computer_access_revoked");
        const conn: Connection = { client, names: new Set(tools.tools.map((item) => item.name)), lastUse: Date.now() };
        client.onclose = () => { if (this.sessions.get(key) === conn) this.sessions.delete(key); };
        this.sessions.set(key, conn);
        return conn;
      } catch (error) {
        await client.close().catch(() => undefined);
        throw error;
      }
    })();
    this.connections.set(key, promise);
    try { return await promise; }
    finally { this.connections.delete(key); }
  }

  async call(provider: Provider, identity: string, tool: string, args: Record<string, unknown>, authorized: () => boolean): Promise<ToolResult> {
    const run = async (): Promise<ToolResult> => {
      let requested = false;
      try {
        if (!authorized()) return fail("computer_disabled", "Computer use access was revoked");
        const connection = await this.connect(provider, identity);
        if (!authorized()) return fail("computer_disabled", "Computer use access was revoked");
        if (!connection.names.has(tool)) return fail("unsupported_tool", tool + " not provided by installed " + provider);
        requested = true;
        const result = await connection.client.callTool({ name: tool, arguments: args }, { timeout: REQUEST_TIMEOUT });
        connection.lastUse = Date.now();
        const content = result.content
          .filter((part) => part.type === "text" || part.type === "image")
          .map((part) => part.type === "text"
            ? { type: "text" as const, text: truncate(part.text, 20_000) }
            : { type: "image" as const, data: part.data, mimeType: part.mimeType });
        if (!content.length) return fail("empty_response", "Cua returned no displayable content");
        if (content[0]?.type !== "text") content.unshift({ type: "text", text: "Cua image result" });
        return { content: content as ToolResult["content"], isError: result.isError };
      } catch (error) {
        if (requested) await this.closeConnection(provider + ":" + identity);
        return fail("cua_unavailable", error instanceof Error ? error.message : "Cua request failed");
      } finally {
        // Requests without an MCP session ID must not consume persistent connection slots.
        if (identity.includes(":call:")) await this.closeConnection(provider + ":" + identity);
      }
    };
    const task = this.serialized.then(run, run);
    this.serialized = task.then(() => undefined, () => undefined);
    return task;
  }
}
