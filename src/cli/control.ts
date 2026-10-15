import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CliConfig } from "./config.ts";
import { dataDirectory } from "./paths.ts";

export type ServerInstance = { pid: number; token: string };
const pidPath = () => join(dataDirectory(), "server.pid");
const controlPath = "/__agent-mcp/control";

export function readInstance(): ServerInstance | undefined {
  try {
    const value = JSON.parse(readFileSync(pidPath(), "utf8")) as Partial<ServerInstance> | null;
    if (!value || !Number.isSafeInteger(value.pid) || (value.pid ?? 0) <= 0 ||
      typeof value.token !== "string" || !/^[a-f0-9]{64}$/.test(value.token)) return undefined;
    return value as ServerInstance;
  } catch {
    return undefined;
  }
}

export function writeInstance(instance: ServerInstance): void {
  mkdirSync(dataDirectory(), { recursive: true, mode: 0o700 });
  writeFileSync(pidPath(), JSON.stringify(instance) + "\n", { mode: 0o600 });
}

export function clearInstance(instance: ServerInstance): void {
  const current = readInstance();
  if (current?.pid === instance.pid && current.token === instance.token) rmSync(pidPath(), { force: true });
}

export async function requestControl(config: CliConfig, instance: ServerInstance, method: "GET" | "POST"): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}${controlPath}`, {
      method,
      headers: { authorization: `Bearer ${instance.token}`, "x-agent-mcp-pid": String(instance.pid) },
      redirect: "error",
      signal: AbortSignal.timeout(1200),
    });
    const body = await response.json() as { pid?: number };
    return response.ok && body.pid === instance.pid;
  } catch {
    return false;
  }
}

export function controlHandler(instance: ServerInstance, shutdown: () => void) {
  return (request: Request): Response | undefined => {
    if (new URL(request.url).pathname !== controlPath) return undefined;
    if (request.headers.get("authorization") !== `Bearer ${instance.token}` ||
      request.headers.get("x-agent-mcp-pid") !== String(instance.pid)) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (request.method !== "GET" && request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    if (request.method === "POST") setTimeout(shutdown, 20);
    return Response.json({ pid: instance.pid }, { headers: { "cache-control": "no-store" } });
  };
}
