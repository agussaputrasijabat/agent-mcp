import * as z from "zod/v4";
import type { Database } from "bun:sqlite";
import type { ToolResult } from "../tools/result.ts";
import { fail, ok } from "../tools/result.ts";
import { currentMcpRequest } from "../mcp/request-context.ts";
import { CuaBridge, allowedApps, computerDiagnostics } from "./bridge.ts";
import { computerSettings } from "./config.ts";
import { expiredSandboxes, forgetSandbox, listOwnedSandboxes, reserveSandbox, sandboxOwned } from "./ownership.ts";

const target = z.object({ kind: z.literal("window"), pid: z.number().int().nonnegative(), window_id: z.number().int().nonnegative() }).strict();
const coords = z.number().int().nonnegative().max(30_000);
const appId = z.string().min(3).max(255);
const hostSchemas = {
  launch_app: z.object({ bundle_id: appId.optional(), path: z.string().min(1).max(512).optional() }).strict().refine((v) => Number(v.bundle_id !== undefined) + Number(v.path !== undefined) === 1),
  list_windows: z.object({ pid: z.number().int().positive() }).strict(),
  get_window_state: z.object({ pid: z.number().int().positive(), window_id: z.number().int().nonnegative(), include_screenshot: z.boolean().optional() }).strict(),
  get_screen_size: z.object({}).strict(),
  click: z.object({ target, x: coords.optional(), y: coords.optional(), element_token: z.string().max(200).optional() }).strict(),
  double_click: z.object({ target, x: coords.optional(), y: coords.optional(), element_token: z.string().max(200).optional() }).strict(),
  right_click: z.object({ target, x: coords.optional(), y: coords.optional(), element_token: z.string().max(200).optional() }).strict(),
  type_text: z.object({ target, text: z.string().max(4000) }).strict(),
  press_key: z.object({ target, key: z.string().regex(/^[\w+-]{1,48}$/) }).strict(),
  hotkey: z.object({ target, keys: z.array(z.string().regex(/^[\w+-]{1,30}$/)).min(1).max(5) }).strict(),
  scroll: z.object({ target, direction: z.enum(["up", "down", "left", "right"]), amount: z.number().int().min(1).max(50) }).strict(),
  drag: z.object({ target, from_x: coords, from_y: coords, to_x: coords, to_y: coords }).strict(),
};
const hostTool = z.enum(Object.keys(hostSchemas) as [keyof typeof hostSchemas, ...(keyof typeof hostSchemas)[]]);
const hostReads = new Set(["list_windows", "get_window_state", "get_screen_size"]);
const sandboxTool = z.enum([
  "images_list", "sandbox_list", "sandbox_get", "sandbox_create", "sandbox_start", "sandbox_stop", "sandbox_delete",
  "computer_screenshot", "computer_click", "computer_type", "computer_key", "computer_scroll",
]);
const sandboxReads = new Set(["images_list", "sandbox_list", "sandbox_get", "computer_screenshot"]);
const sandboxActions = new Set(["computer_click", "computer_type", "computer_key", "computer_scroll"]);
const jsonParams = z.record(z.string(), z.unknown());

export const computerDriverInput = z.object({ action: hostTool, parameters: jsonParams.default({}) }).strict();
export const computerSandboxInput = z.object({ action: sandboxTool, parameters: jsonParams.default({}) }).strict();

function principal(): string | undefined {
  const ctx = currentMcpRequest();
  return ctx?.authSubject ? ctx.authKind + ":" + ctx.authSubject : undefined;
}

function sessionIdentity(owner: string): string {
  const header = currentMcpRequest()?.request.headers.get("mcp-session-id");
  // Never silently share mutable Cua session state across unrelated conversations on the same API key.
  return header && /^[\w-]{8,128}$/.test(header) ? owner + ":session:" + header : owner + ":call:" + crypto.randomUUID();
}

export function computerStatus(db: Database): ToolResult {
  return ok(JSON.stringify({ settings: computerSettings(db), runtimes: computerDiagnostics() }));
}

export function validateHostAction(action: z.infer<typeof hostTool>, args: Record<string, unknown>): string | null {
  if (JSON.stringify(args).length > 12_000) return "Request is too large";
  const schema = hostSchemas[action];
  const validation = schema.safeParse(args);
  if (!validation.success) return "Unsupported or invalid " + action + " parameters";
  if (action === "launch_app") {
    const app = typeof args.bundle_id === "string" ? args.bundle_id : args.path;
    if (typeof app !== "string" || !allowedApps().has(app)) return "App is not in CUA_DRIVER_ALLOWED_APPS";
  }
  return null;
}

export async function computerDriver(db: Database, bridge: CuaBridge, input: z.infer<typeof computerDriverInput>): Promise<ToolResult> {
  const settings = computerSettings(db);
  const read = hostReads.has(input.action);
  if (!settings.driver_observe || (!read && !settings.driver_control)) return fail("computer_disabled", "Enable the required Cua Driver permission in Computer settings");
  const driver = computerDiagnostics().driver as { compatible?: boolean; bounded?: boolean };
  if (!driver.compatible) return fail("driver_outdated", "Cua Driver 0.28 or newer is required");
  if (!driver.bounded) return fail("driver_unbounded", "An approved bounded Cua Driver manifest and app allowlist are required");
  const caller = principal();
  if (!caller) return fail("unauthorized", "Authenticated MCP context required");
  const error = validateHostAction(input.action, input.parameters);
  if (error) return fail("invalid_parameters", error);
  return bridge.call("driver", sessionIdentity(caller), input.action, input.parameters, () => {
    const current = computerSettings(db);
    return current.driver_observe && (read || current.driver_control);
  });
}

function objectOnly(args: Record<string, unknown>, names: string[]): boolean {
  return Object.keys(args).every((name) => names.includes(name));
}

export function validateSandboxAction(action: z.infer<typeof sandboxTool>, args: Record<string, unknown>): string | null {
  if (JSON.stringify(args).length > 8000) return "Request is too large";
  if (action === "sandbox_list" && (!objectOnly(args, ["location"]) || (args.location && args.location !== "local"))) return "Only local sandbox discovery is allowed";
  if (action === "sandbox_create") {
    if (!objectOnly(args, ["name", "image", "kind", "runtime", "os_type", "on"])) return "Sandbox environment, commands, URLs and services are not allowed";
    if (args.on !== undefined && args.on !== "local") return "Only local sandbox creation is allowed";
    if (args.os_type !== undefined && args.os_type !== "linux") return "Only Linux sandbox creation is allowed";
    if (args.kind !== undefined && args.kind !== "container") return "Only container sandbox creation is allowed";
    if (args.runtime !== undefined && !["runc", "gvisor"].includes(String(args.runtime))) return "Unsupported local runtime";
    if (typeof args.name !== "string" || !/^[a-z][a-z0-9-]{0,40}$/.test(args.name)) return "Sandbox name is required (lowercase alphanumeric and hyphen)";
    if (args.image !== undefined && !["linux", "ubuntu"].includes(String(args.image))) return "Only trusted Linux image aliases are allowed";
  }
  if (["sandbox_get", "sandbox_start", "sandbox_stop", "sandbox_delete"].includes(action)) {
    if (!objectOnly(args, ["name"]) || typeof args.name !== "string" || !/^local:[a-z][a-z0-9-]{0,40}$/.test(args.name)) return "Explicit local: sandbox name required";
  }
  if (action === "images_list" && Object.keys(args).length) return "images_list does not accept parameters";
  if (sandboxActions.has(action) || action === "computer_screenshot") {
    if (typeof args.sandbox !== "string" || !/^local:[a-z][a-z0-9-]{0,40}$/.test(args.sandbox)) return "Explicit local: sandbox reference required";
    const permitted = action === "computer_screenshot" ? ["sandbox"]
      : action === "computer_click" ? ["sandbox", "x", "y", "button"]
      : action === "computer_type" ? ["sandbox", "text"]
      : action === "computer_key" ? ["sandbox", "key"]
      : ["sandbox", "direction", "amount"];
    if (!objectOnly(args, permitted)) return "Unsupported sandbox computer parameter";
    if (action === "computer_click" &&
      (!Number.isInteger(args.x) || !Number.isInteger(args.y) ||
        (args.button !== undefined && !["left", "right", "middle"].includes(String(args.button))))) return "Valid x, y and button required";
    if (action === "computer_type" && (typeof args.text !== "string" || args.text.length > 4000)) return "text must be a string up to 4000 characters";
    if (action === "computer_key" && (typeof args.key !== "string" || !/^[a-zA-Z0-9_+\-]{1,48}$/.test(args.key))) return "Invalid key";
    if (action === "computer_scroll" &&
      (args.direction !== undefined && !["up", "down", "left", "right"].includes(String(args.direction)) ||
        args.amount !== undefined && (!Number.isInteger(args.amount) || Number(args.amount) < 1 || Number(args.amount) > 50))) return "Invalid scroll direction or amount";
  }
  return null;
}

export async function computerSandbox(db: Database, bridge: CuaBridge, input: z.infer<typeof computerSandboxInput>): Promise<ToolResult> {
  const settings = computerSettings(db);
  const read = sandboxReads.has(input.action);
  if (!settings.sandbox_observe || (!read && !settings.sandbox_manage)) return fail("computer_disabled", "Enable the required Cua sandbox permission in Computer settings");
  const caller = principal();
  if (!caller) return fail("unauthorized", "Authenticated MCP context required");
  const error = validateSandboxAction(input.action, input.parameters);
  if (error) return fail("invalid_parameters", error);
  if (input.action === "sandbox_list") return ok(JSON.stringify({ sandboxes: listOwnedSandboxes(db, caller) }));
  const args = { ...input.parameters };
  if (input.action === "sandbox_create") {
    // The upstream create API exposes no CPU/RAM/disk parameters. Require independently enforced
    // runtime quotas on the host, not merely a client-supplied request field.
    if (process.env.CUA_SANDBOX_RUNTIME_QUOTAS_VERIFIED !== "1") {
      return fail("sandbox_resource_limits_required", "Configure CPU, memory and disk quotas on the local Cua runtime first");
    }
    args.on = "local"; args.os_type = "linux"; args.kind = "container";
    const name = "local:" + args.name;
    const quota = reserveSandbox(db, caller, name);
    if (quota) return fail(quota, "Sandbox quota reached or name already reserved");
  } else if (!["images_list"].includes(input.action)) {
    const name = typeof args.sandbox === "string" ? args.sandbox : String(args.name ?? "");
    if (!sandboxOwned(db, caller, name)) return fail("sandbox_not_owned", "This client does not own the requested sandbox");
  }
  const result = await bridge.call("sandbox", sessionIdentity(caller), input.action, args, () => {
    const current = computerSettings(db);
    return current.sandbox_observe && (read || current.sandbox_manage);
  });
  // Keep the reservation after ambiguous errors to prevent untracked, still-running sandboxes.
  if (!result.isError && input.action === "sandbox_delete") forgetSandbox(db, caller, String(args.name));
  return result;
}

export function startSandboxCleanup(db: Database, bridge: CuaBridge): void {
  const timer = setInterval(async () => {
    let expired: { name: string; owner: string }[] = [];
    try { expired = expiredSandboxes(db); }
    catch { clearInterval(timer); return; }
    for (const entry of expired) {
      const result = await bridge.call("sandbox", "cleanup:" + entry.owner, "sandbox_delete", { name: entry.name }, () => true);
      if (!result.isError) forgetSandbox(db, entry.owner, entry.name);
    }
  }, 60_000);
  timer.unref();
}
