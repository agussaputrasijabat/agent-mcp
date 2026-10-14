import type { Database } from "bun:sqlite";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { decideMcpAuth, mcpAuthResponse } from "./auth/mcp-auth.ts";
import { clientIp, LoginLimiter } from "./auth/login-limit.ts";
import { createOperatorAuth, seedOperator, type OperatorAuth } from "./auth/operator.ts";
import { ensureSettings, readSettings } from "./db/settings.ts";
import { fail, ok } from "./http/json.ts";
import { loginPage } from "./http/login-page.ts";
import { createHostHandler } from "./mcp/handler.ts";
import { assertInstructions, readServerInstructions } from "./mcp/instructions.ts";

export type AppOptions = {
  instructions?: string;
  shellConcurrency?: number;
  secret?: string;
  baseURL?: string;
  operator?: { email: string; password: string };
  trustProxy?: boolean;
};

export async function createApp(db: Database, options: AppOptions = {}) {
  const secret = options.secret ?? process.env.BETTER_AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("auth_secret_missing");
  const baseURL = options.baseURL ?? process.env.PUBLIC_BASE_URL ?? "http://127.0.0.1:3000";
  const email = options.operator?.email ?? process.env.DASHBOARD_EMAIL ?? "";
  const password = options.operator?.password ?? process.env.DASHBOARD_PASSWORD ?? "";
  if (!email || password.length < 12) throw new Error("operator_env_missing");

  const auth = await createOperatorAuth(db, { secret, baseURL });
  await seedOperator(auth, db, email, password);
  ensureSettings(db, baseURL);

  const instructions = assertInstructions(options.instructions ?? readServerInstructions());
  const handler = createHostHandler({
    db,
    instructions,
    shellConcurrency: options.shellConcurrency,
    limits: () => readSettings(db),
  });
  const limiter = new LoginLimiter();
  const trustProxy = options.trustProxy ?? process.env.TRUST_PROXY === "true";
  const app = createMcpHonoApp({ allowedHosts: ["localhost", "127.0.0.1", new URL(baseURL).hostname] });

  app.get("/health", (c) => {
    db.query("SELECT 1 AS ok").get();
    return c.json({ data: { ok: true }, error: null });
  });

  app.get("/login", (c) => c.html(loginPage()));
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

  app.post("/api/login", async (c) => {
    const ip = clientIp(c.req.raw, trustProxy);
    if (limiter.tooMany(ip)) return fail(c, 429, "rate_limited", "Too many sign-in attempts");
    const body = await c.req.json().catch(() => null) as { email?: string; password?: string } | null;
    const response = await auth.api.signInEmail({
      body: { email: body?.email ?? "", password: body?.password ?? "" },
      asResponse: true,
    });
    if (!response.ok) {
      limiter.recordFailure(ip);
      return fail(c, 401, "unauthorized", "Nama atau kata sandi salah.");
    }
    const headers = new Headers({ "content-type": "application/json" });
    for (const cookie of response.headers.getSetCookie()) headers.append("set-cookie", cookie);
    return new Response(JSON.stringify({ data: { email: body?.email ?? "" }, error: null }), {
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

  app.get("/api/me", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return fail(c, 401, "unauthorized", "Sign in required");
    return ok(c, { email: session.user.email });
  });

  app.all("/mcp", (c) => {
    const decision = decideMcpAuth(c.req.raw, db, baseURL);
    if (!decision.ok) return mcpAuthResponse(decision, baseURL);
    return handler.fetch(c.req.raw, { parsedBody: c.get("parsedBody") });
  });

  return app;
}

export type { OperatorAuth };
