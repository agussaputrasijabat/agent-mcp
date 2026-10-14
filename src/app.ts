import type { Database } from "bun:sqlite";
import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { oauthProviderAuthServerMetadata, verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { decideMcpAuth, mcpAuthResponse } from "./auth/mcp-auth.ts";
import { clientIp, LoginLimiter } from "./auth/login-limit.ts";
import { createOperatorAuth, mcpResourceUrl, seedOperator, type OperatorAuth } from "./auth/operator.ts";
import { ensureSettings, readSettings } from "./db/settings.ts";
import { consentPage } from "./http/consent-page.ts";
import { fail, ok } from "./http/json.ts";
import { loginPage } from "./http/login-page.ts";
import { createHostHandler } from "./mcp/handler.ts";
import { assertInstructions, readServerInstructions } from "./mcp/instructions.ts";

declare module "hono" {
  interface ContextVariableMap {
    parsedBody: unknown;
  }
}

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
  const resource = mcpResourceUrl(baseURL);

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

  app.get("/api/me", async (c) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return fail(c, 401, "unauthorized", "Sign in required");
    return ok(c, { email: session.user.email });
  });

  app.all("/mcp", (c) => {
    const decision = decideMcpAuth(c.req.raw, db, baseURL);
    if (!decision.ok) return mcpAuthResponse(decision, baseURL);
    const run = (request: Request) => handler.fetch(request, { parsedBody: c.get("parsedBody") });
    if (decision.kind === "oauth") {
      return requireMcpAuth(auth, run, { resource, requiredScopes: ["mcp"] })(c.req.raw);
    }
    return run(c.req.raw);
  });

  return Object.assign(app, { auth });
}

export type { OperatorAuth };
