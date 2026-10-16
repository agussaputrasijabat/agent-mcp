import type { Database } from "bun:sqlite";
import type { Context } from "hono";
import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { localhostAllowedHostnames, localhostAllowedOrigins } from "@modelcontextprotocol/server";
import { oauthProviderAuthServerMetadata, verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { decideMcpAuth, mcpAuthResponse } from "./auth/mcp-auth.ts";
import { clientIp, LoginLimiter } from "./auth/login-limit.ts";
import { createOperatorAuth, mcpResourceUrl, seedOperator, serverPort, type OperatorAuth } from "./auth/operator.ts";
import { ensureSettings, readSettings } from "./db/settings.ts";
import { consentPage } from "./http/consent-page.ts";
import { fail, ok } from "./http/json.ts";
import { decodeCursor, getToolCall, listSessions, listToolCalls } from "./db/tool-calls.ts";
import { dashboardPage, registerDashboard } from "./http/dashboard.ts";
import { createHostHandler } from "./mcp/handler.ts";
import { CuaBridge } from "./computer/bridge.ts";
import { startSandboxCleanup } from "./computer/tools.ts";
import { runMcpRequest } from "./mcp/request-context.ts";
import { assertInstructions, etagMatches, instructionModes, isInstructionMode, readInstructionPack, readServerInstructions } from "./mcp/instructions.ts";

declare module "hono" {
  interface ContextVariableMap {
    parsedBody: unknown;
  }
}

export const MIN_OPERATOR_PASSWORD_LENGTH = 12;

export type OperatorEnvError = "operator_env_missing" | "password_too_short";

export function operatorEnvError(email: string, password: string): OperatorEnvError | null {
  if (!email || password.length === 0) return "operator_env_missing";
  if (password.length < MIN_OPERATOR_PASSWORD_LENGTH) return "password_too_short";
  return null;
}

export type AppOptions = {
  instructions?: string;
  shellConcurrency?: number;
  secret?: string;
  baseURL?: string;
  operator?: { email: string; password: string };
  trustProxy?: boolean;
  allowedHosts?: string;
  port?: number;
};

function existingOperator(db: Database): boolean {
  const table = db.query("SELECT name FROM sqlite_master WHERE type = ? AND name = ?").get("table", "user");
  return !!table && !!db.query("SELECT id FROM user LIMIT 1").get();
}

export async function createApp(db: Database, options: AppOptions = {}) {
  const secret = options.secret ?? process.env.BETTER_AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("auth_secret_missing");
  const baseURL = options.baseURL ?? process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:3000";
  const email = options.operator?.email ?? process.env.DASHBOARD_EMAIL ?? "";
  const password = options.operator?.password ?? process.env.DASHBOARD_PASSWORD ?? "";
  const envError = operatorEnvError(email, password);
  if (envError && !(envError === "operator_env_missing" && email && existingOperator(db))) throw new Error(envError);

  const auth = await createOperatorAuth(db, { secret, baseURL, port: serverPort(options.port) });
  if (password) await seedOperator(auth, db, email, password);
  ensureSettings(db, baseURL);
  const resource = mcpResourceUrl(baseURL);

  const instructions = assertInstructions(options.instructions ?? readServerInstructions());
  for (const mode of instructionModes) readInstructionPack(mode);
  const computerBridge = new CuaBridge();
  startSandboxCleanup(db, computerBridge);
  const handler = createHostHandler({
    computerBridge,
    db,
    instructions,
    shellConcurrency: options.shellConcurrency,
    limits: () => readSettings(db),
  });
  const limiter = new LoginLimiter();
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === "true";
  const hostnames = serverHostnames(baseURL, options.allowedHosts ?? process.env.ALLOWED_HOSTS);
  const app = createMcpHonoApp({ allowedHosts: hostnames, allowedOrigins: hostnames });

  app.get("/health", (c) => {
    db.query("SELECT 1 AS ok").get();
    return c.json({ data: { ok: true }, error: null });
  });

  app.get("/instructions/:file", (c) => {
    const match = /^([a-z]+)\.md$/.exec(c.req.param("file"));
    const mode = match?.[1];
    if (!mode || !isInstructionMode(mode)) return c.text("Not found", 404);
    const pack = readInstructionPack(mode);
    const etag = `"${pack.version}"`;
    const headers = { etag, "cache-control": "no-cache", "x-content-type-options": "nosniff" };
    if (etagMatches(c.req.header("if-none-match"), etag)) return c.body(null, 304, headers);
    return c.body(pack.text, 200, { ...headers, "content-type": "text/markdown; charset=utf-8" });
  });

  app.get("/login", () => dashboardPage());
  app.get("/consent", async (c) => {
    const query = new URL(c.req.url).search.slice(1);
    const params = new URLSearchParams(query);
    const valid = query.length > 0 && (await verifyOAuthQueryParams(query, secret));
    return c.html(consentPage({ valid, clientId: params.get("client_id") ?? "", scope: params.get("scope") ?? "" }));
  });
  app.on(["GET", "POST"], "/api/auth/*", async (c) => {
    const emailSignIn = c.req.method === "POST" && new URL(c.req.url).pathname === "/api/auth/sign-in/email";
    const ip = clientIp(c, trustProxy);
    if (emailSignIn && limiter.tooMany(ip)) return fail(c, 429, "rate_limited", "Too many sign-in attempts");
    const response = await auth.handler(c.req.raw);
    if (emailSignIn && !response.ok) limiter.recordFailure(ip);
    return response;
  });
  app.get("/.well-known/oauth-authorization-server", (c) => oauthProviderAuthServerMetadata(auth)(c.req.raw));
  app.on(["GET", "HEAD"], "/.well-known/oauth-protected-resource", (c) => auth.handler(c.req.raw));
  app.on(["GET", "HEAD"], "/.well-known/oauth-protected-resource/mcp", (c) => auth.handler(c.req.raw));

  app.post("/api/login", async (c) => {
    const ip = clientIp(c, trustProxy);
    if (limiter.tooMany(ip)) return fail(c, 429, "rate_limited", "Too many sign-in attempts");
    const body = await c.req.json().catch(() => null) as { email?: string; password?: string; oauth_query?: string } | null;
    const response = await auth.api.signInEmail({
      body: {
        email: body?.email ?? "",
        password: body?.password ?? "",
        ...(body?.oauth_query ? { oauth_query: body.oauth_query } : {}),
      } as { email: string; password: string },
      headers: c.req.raw.headers,
      request: c.req.raw,
      asResponse: true,
    });
    if (!response.ok) {
      limiter.recordFailure(ip);
      return fail(c, 401, "unauthorized", "Nama atau kata sandi salah.");
    }
    const payload = (await response.json().catch(() => null)) as { redirect?: boolean; url?: string } | null;
    const redirect = payload?.redirect === true && typeof payload.url === "string" ? payload.url : null;
    const headers = new Headers({ "content-type": "application/json" });
    for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
    return new Response(JSON.stringify({ data: { email: body?.email ?? "", redirect }, error: null }), {
      status: 200,
      headers,
    });
  });

  app.post("/api/logout", async (c) => {
    const response = await auth.api.signOut({ headers: c.req.raw.headers, asResponse: true });
    const headers = new Headers({ "content-type": "application/json" });
    for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
    return new Response(JSON.stringify({ data: { ok: true }, error: null }), { status: 200, headers });
  });

  const operator = async (c: Context) => auth.api.getSession({ headers: c.req.raw.headers });

  app.get("/api/me", async (c) => {
    const session = await operator(c);
    if (!session) return fail(c, 401, "unauthorized", "Sign in required");
    return ok(c, { email: session.user.email });
  });

  app.get("/api/tool-calls", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    const limit = readLimit(c.req.query("limit"));
    if (limit === "invalid") return fail(c, 400, "validation_error", "limit must be from 1 to 100");
    const cursor = readPairCursor(c.req.query("cursor"));
    if (cursor === "invalid") return fail(c, 400, "validation_error", "cursor is not valid");
    const page = listToolCalls(db, {
      limit,
      cursor: cursor ? { startedAt: cursor[0] ?? "", id: cursor[1] ?? "" } : undefined,
      toolName: c.req.query("tool_name") || undefined,
      sessionKey: c.req.query("session_key") || undefined,
    });
    return ok(c, { items: page.items, next_cursor: page.nextCursor });
  });

  app.get("/api/tool-calls/:id", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    const row = getToolCall(db, c.req.param("id"));
    if (!row) return fail(c, 404, "not_found", "Not found");
    return ok(c, row);
  });

  app.get("/api/sessions", async (c) => {
    if (!(await operator(c))) return fail(c, 401, "unauthorized", "Sign in required");
    const limit = readLimit(c.req.query("limit"));
    if (limit === "invalid") return fail(c, 400, "validation_error", "limit must be from 1 to 100");
    const cursor = readPairCursor(c.req.query("cursor"));
    if (cursor === "invalid") return fail(c, 400, "validation_error", "cursor is not valid");
    const page = listSessions(db, {
      limit,
      cursor: cursor ? { lastStartedAt: cursor[0] ?? "", sessionKey: cursor[1] ?? "" } : undefined,
    });
    return ok(c, { items: page.items, next_cursor: page.nextCursor });
  });

  app.get("/", async (c) => {
    if (!(await operator(c))) return c.redirect("/login");
    return dashboardPage();
  });

  app.get("/sessions", async (c) => {
    if (!(await operator(c))) return c.redirect("/login");
    return dashboardPage();
  });

  app.get("/sessions/:sessionKey", async (c) => {
    if (!(await operator(c))) return c.redirect("/login");
    return dashboardPage();
  });

  app.all("/mcp", (c) => {
    const decision = decideMcpAuth(c.req.raw, db, baseURL);
    if (!decision.ok) return mcpAuthResponse(decision, baseURL);
    const run = (request: Request) => handler.fetch(request, { parsedBody: c.get("parsedBody") });
    if (decision.kind === "oauth") {
      return requireMcpAuth(
        auth,
        (request, claims) =>
          runMcpRequest(
            {
              request,
              authKind: "oauth",
              authSubject: typeof claims.sub === "string" ? claims.sub : "",
              credential: decision.credential,
            },
            () => run(request),
          ),
        { resource, requiredScopes: ["mcp"] },
      )(c.req.raw);
    }
    return runMcpRequest(
      { request: c.req.raw, authKind: "api_key", authSubject: decision.subject, credential: decision.credential },
      () => run(c.req.raw),
    );
  });

  registerDashboard(app, db, operator, computerBridge);

  return Object.assign(app, { auth });
}

function serverHostnames(baseURL: string, extra: string | undefined): string[] {
  const names = new Set<string>([...localhostAllowedHostnames(), ...localhostAllowedOrigins(), new URL(baseURL).hostname]);
  for (const part of (extra ?? "").split(",")) {
    const trimmed = part.trim();
    if (trimmed.length === 0) continue;
    names.add(hostnameOf(trimmed));
  }
  return [...names];
}

function hostnameOf(value: string): string {
  try {
    const url = value.includes("://") ? new URL(value) : new URL(`http://${value}`);
    if (url.hostname.length === 0) throw new Error("empty");
    return url.hostname;
  } catch (error) {
    if (error instanceof TypeError) throw new Error("allowed_host_invalid");
    throw error;
  }
}

function readLimit(value: string | undefined): number | "invalid" {
  if (value === undefined || value === "") return 50;
  if (!/^\d+$/.test(value)) return "invalid";
  const limit = Number(value);
  if (limit < 1) return "invalid";
  return Math.min(limit, 100);
}

function readPairCursor(value: string | undefined): string[] | undefined | "invalid" {
  if (value === undefined || value === "") return undefined;
  const decoded = decodeCursor(value);
  return decoded ?? "invalid";
}

export type { OperatorAuth };
