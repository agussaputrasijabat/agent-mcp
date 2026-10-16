import { resourceBytes, resourceResponse } from "../resources.ts";
import { computerSettings, updateComputerSettings } from "../computer/config.ts";
import { CuaBridge, computerDiagnostics } from "../computer/bridge.ts";
import { autostartStatus, enableAutostart, disableAutostart, isStandaloneBinary } from "../cli/autostart.ts";
import type { Database } from "bun:sqlite";
import type { Context, Hono } from "hono";
import { KeyValidationError, createApiKey, revokeApiKey } from "../auth/keys.ts";
import { SettingsError, readSettings, updateSettings } from "../db/settings.ts";
import { likeContains } from "../tools/names.ts";
import { memoryForget, memorySave } from "../tools/memory.ts";
import { skillDelete, skillRead, skillSave } from "../tools/skills.ts";
import { fail, ok } from "./json.ts";
import type { ToolResult } from "../tools/result.ts";

const hourMs = 60 * 60 * 1000;
const monthMs = 30 * 24 * hourMs;

type OperatorCheck = (c: Context) => Promise<unknown>;

export function registerDashboard(app: Hono, db: Database, operator: OperatorCheck, computerBridge?: CuaBridge) {
  app.get("/fonts/Geist-Variable.woff2", () => {
    return resourceResponse("node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2", "font/woff2");
  });

  app.get("/api/api-keys", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    const items = db.query(
      "SELECT id, name, key_prefix, created_at, last_used_at, revoked_at FROM api_keys ORDER BY created_at DESC",
    ).all();
    return ok(c, { items });
  });

  app.post("/api/api-keys", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    const body = await c.req.json().catch(() => null) as { name?: unknown } | null;
    if (!body || typeof body.name !== "string" || body.name.trim().length < 1 || body.name.trim().length > 64) {
      return fail(c, 400, "validation_error", "name must be 1 to 64 characters");
    }
    const since = new Date(Date.now() - hourMs).toISOString();
    const recent = db.query("SELECT COUNT(*) AS count FROM api_keys WHERE created_at >= ?").get(since) as { count: number };
    if (recent.count >= 20) return fail(c, 429, "rate_limited", "Too many keys created");
    try {
      const created = createApiKey(db, body.name);
      return ok(c, { ...publicKey(created.row), secret: created.secret }, 201);
    } catch (error) {
      if (error instanceof KeyValidationError) return fail(c, 400, "validation_error", error.message);
      throw error;
    }
  });

  app.post("/api/api-keys/:id/revoke", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    const row = revokeApiKey(db, c.req.param("id"));
    if (!row) return fail(c, 404, "not_found", "Not found");
    return ok(c, publicKey(row));
  });

  app.get("/api/clients", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    const since = new Date(Date.now() - monthMs).toISOString();
    const apiKeys = db.query(
      "SELECT id, name, key_prefix, last_used_at FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC",
    ).all();
    const oauth = db.query(
      `SELECT client_name, MAX(started_at) AS last_used_at
       FROM tool_calls
       WHERE auth_kind = 'oauth' AND client_name IS NOT NULL AND started_at >= ?
       GROUP BY client_name
       ORDER BY last_used_at DESC`,
    ).all(since);
    return ok(c, { api_keys: apiKeys, oauth });
  });

  app.get("/api/autostart", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    return ok(c, { ...await autostartStatus(), supported: isStandaloneBinary() });
  });

  app.post("/api/autostart", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    if (!isStandaloneBinary()) return fail(c, 409, "standalone_required", "Autostart requires the installed standalone CLI");
    const body = await c.req.json().catch(() => null) as { enabled?: unknown } | null;
    if (typeof body?.enabled !== "boolean") return fail(c, 400, "validation_error", "enabled must be a boolean");
    try {
      const state = body.enabled ? await enableAutostart() : await disableAutostart();
      return ok(c, state);
    } catch (error) {
      return fail(c, 500, "autostart_failed", error instanceof Error ? error.message : "Autostart failed");
    }
  });

  app.get("/api/computer", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    return ok(c, { settings: computerSettings(db), runtimes: computerDiagnostics() });
  });

  app.patch("/api/computer", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    if (c.req.header("x-agent-mcp-action") !== "computer-settings" ||
        !c.req.header("content-type")?.startsWith("application/json")) {
      return fail(c, 403, "action_header_required", "Computer settings require an explicit same-site JSON action");
    }
    const body = await c.req.json().catch(() => null);
    try {
      const before = computerSettings(db);
      const after = updateComputerSettings(db, body);
      if ((before.driver_observe && !after.driver_observe) || (before.driver_control && !after.driver_control) ||
          (before.sandbox_observe && !after.sandbox_observe) || (before.sandbox_manage && !after.sandbox_manage)) {
        await computerBridge?.closeAll();
      }
      return ok(c, { settings: after, runtimes: computerDiagnostics() });
    } catch (error) {
      return fail(c, 400, "validation_error", error instanceof Error ? error.message : "Invalid computer settings");
    }
  });

  app.get("/api/settings", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    return ok(c, readSettings(db));
  });

  app.patch("/api/settings", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) return fail(c, 400, "validation_error", "Settings body must be an object");
    try {
      return ok(c, updateSettings(db, body as Record<string, unknown>));
    } catch (error) {
      if (error instanceof SettingsError) return fail(c, 400, error.code, error.message);
      throw error;
    }
  });

  app.get("/api/memories", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    const q = c.req.query("q");
    const statement = `SELECT key, body, project_path, updated_at FROM (
      SELECT key, body, project_path, updated_at FROM memories
      UNION ALL
      SELECT key, body, NULLIF(project_path, '') AS project_path, updated_at FROM project_memories
    ) ${q ? "WHERE key LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'" : ""}
    ORDER BY updated_at DESC`;
    const items = q ? db.query(statement).all(likeContains(q), likeContains(q)) : db.query(statement).all();
    return ok(c, { items });
  });

  app.post("/api/memories", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    const body = await c.req.json().catch(() => null) as { key?: unknown; body?: unknown; project_path?: unknown } | null;
    if (!body || typeof body.key !== "string" || typeof body.body !== "string") {
      return fail(c, 400, "validation_error", "key and body are required");
    }
    const project = typeof body.project_path === "string" && body.project_path.length > 0 ? body.project_path : undefined;
    const result = memorySave(db, { key: body.key, body: body.body, project_path: project });
    const error = toolError(result);
    if (error) return fail(c, error.code === "not_found" ? 404 : 400, error.code, error.message);
    return ok(c, { key: body.key, body: body.body, project_path: project ?? null, updated_at: new Date().toISOString() });
  });

  app.delete("/api/memories/:key", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    const project = c.req.query("project_path");
    const result = memoryForget(db, { key: c.req.param("key"), project_path: project || undefined });
    const error = toolError(result);
    if (error) return fail(c, error.code === "not_found" ? 404 : 400, error.code, error.message);
    return ok(c, { ok: true });
  });

  app.get("/api/skills", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    const items = db.query("SELECT name, description, updated_at FROM skills ORDER BY name ASC").all();
    return ok(c, { items });
  });

  app.post("/api/skills", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    const body = await c.req.json().catch(() => null) as { name?: unknown; description?: unknown; body?: unknown } | null;
    if (!body || typeof body.name !== "string" || typeof body.description !== "string" || typeof body.body !== "string") {
      return fail(c, 400, "validation_error", "name, description, and body are required");
    }
    const result = skillSave(db, { name: body.name, description: body.description, body: body.body });
    const error = toolError(result);
    if (error) return fail(c, 400, error.code, error.message);
    const row = db.query("SELECT name, description, body, updated_at FROM skills WHERE name = ?").get(body.name);
    return ok(c, row);
  });

  app.get("/api/skills/:name", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    const result = skillRead(db, { name: c.req.param("name") });
    const error = toolError(result);
    if (error) return fail(c, error.code === "not_found" ? 404 : 400, error.code, error.message);
    const row = db.query("SELECT name, description, body, updated_at FROM skills WHERE name = ?").get(c.req.param("name"));
    return ok(c, row);
  });

  app.delete("/api/skills/:name", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    const result = skillDelete(db, { name: c.req.param("name") });
    const error = toolError(result);
    if (error) return fail(c, error.code === "not_found" ? 404 : 400, error.code, error.message);
    return ok(c, { ok: true });
  });

  const page = async (c: Context) => {
    if (!(await operator(c))) return c.redirect("/login");
    return dashboardPage();
  };

  for (const path of ["/keys", "/clients", "/settings", "/computer", "/memories", "/skills", "/skills/new", "/docs", "/setup"]) {
    app.get(path, page);
  }
  app.get("/tutorial", (c) => c.redirect("/docs"));
  app.get("/skills/:name", page);
  app.get("/favicon.svg", () => {
    return resourceResponse("web/public/favicon.svg", "image/svg+xml; charset=utf-8");
  });
  app.get("/assets/*", async (c) => {
    const name = c.req.path.slice("/assets/".length);
    if (name.includes("..") || name.includes("/")) return new Response("Not found", { status: 404 });
    const contentType = name.endsWith(".js") ? "text/javascript; charset=utf-8" : name.endsWith(".css") ? "text/css; charset=utf-8" : name.endsWith(".woff2") ? "font/woff2" : "application/octet-stream";
    return resourceResponse(`dist/web/assets/${name}`, contentType);
  });
}

export async function dashboardPage(): Promise<Response> {
  const bytes = resourceBytes("dist/web/index.html");
  if (!bytes) return new Response("Dashboard build is missing", { status: 500 });
  return new Response(bytes.slice().buffer, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function publicKey(row: { id: string; name: string; key_prefix: string; created_at: string; last_used_at: string | null; revoked_at: string | null }) {
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
  };
}

function toolError(result: ToolResult): { code: string; message: string } | null {
  if (!result.isError) return null;
  const text = result.content[0].text.replace(/\n\[truncated\]$/, "");
  const match = /^error ([a-z0-9_]+): ([\s\S]*)$/.exec(text);
  return { code: match?.[1] ?? "validation_error", message: match?.[2] ?? text };
}
