import { createHash } from "node:crypto";
import { expect, test } from "bun:test";
import { createApiKey } from "../src/auth/keys.ts";
import { openDatabase } from "../src/db/database.ts";
import { testApp, testOperator } from "./harness.ts";

const redirectUris = [
  "https://chatgpt.com/connector_platform_oauth_redirect",
  "https://claude.ai/api/mcp/auth_callback",
];

test("oauth metadata is public and an api key still lists tools", async () => {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
    original(...args);
  };
  const db = openDatabase(":memory:");
  let app: Awaited<ReturnType<typeof testApp>>;
  try {
    app = await testApp(db);
  } finally {
    console.error = original;
  }
  expect(errors.join("\n")).not.toContain("Missing tables");

  const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
  const names = new Set(tables.map((row) => row.name));
  for (const table of ["user", "session", "account", "verification"]) expect(names.has(table)).toBe(true);

  const authorization = await app.request("/.well-known/oauth-authorization-server", { headers: { host: "127.0.0.1" } });
  expect(authorization.status).toBe(200);
  const authDoc = (await authorization.json()) as {
    authorization_endpoint?: string;
    token_endpoint?: string;
    code_challenge_methods_supported?: string[];
    client_id_metadata_document_supported?: boolean;
  };
  expect(authDoc.authorization_endpoint).toContain("/oauth2/authorize");
  expect(authDoc.token_endpoint).toContain("/oauth2/token");
  expect(authDoc.code_challenge_methods_supported).toContain("S256");
  expect(authDoc.client_id_metadata_document_supported).toBe(true);

  const resource = await app.request("/.well-known/oauth-protected-resource", { headers: { host: "127.0.0.1" } });
  expect(resource.status).toBe(200);
  const resourceDoc = (await resource.json()) as { resource?: string };
  expect(resourceDoc.resource).toBe("http://127.0.0.1:3000/mcp");

  const pathResource = await app.request("/.well-known/oauth-protected-resource/mcp", { headers: { host: "127.0.0.1" } });
  expect(pathResource.status).toBe(200);

  const created = createApiKey(db, "laptop");
  const listed = await app.request("/mcp", {
    method: "POST",
    headers: {
      host: "127.0.0.1",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${created.secret}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(listed.status).toBe(200);

  const missing = await app.request("/mcp", {
    method: "POST",
    headers: { host: "127.0.0.1", "content-type": "application/json" },
    body: "{}",
  });
  expect(missing.status).toBe(401);
  expect(missing.headers.get("www-authenticate")).toContain("resource_metadata");
  db.close();
});

test("consent deny issues no token and allow lets tools/list through", async () => {
  let fetchApp: { fetch: (request: Request) => Response | Promise<Response> } | undefined;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: (request) => {
      if (!fetchApp) return new Response("booting", { status: 503 });
      return fetchApp.fetch(request);
    },
  });
  const baseURL = `http://127.0.0.1:${server.port}`;
  const db = openDatabase(":memory:");
  const app = await testApp(db, { baseURL });
  fetchApp = app;
  const resource = `${baseURL}/mcp`;

  await app.auth.$context.then(async (ctx) => {
    await ctx.adapter.create({
      model: "oauthClient",
      data: {
        clientId: "test-chatgpt",
        name: "ChatGPT",
        redirectUris: redirectUris,
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        tokenEndpointAuthMethod: "none",
        applicationType: "web",
        requirePKCE: true,
        disabled: false,
        skipConsent: false,
        scopes: ["openid", "profile", "email", "offline_access", "mcp"],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    await ctx.adapter.create({
      model: "oauthClientResource",
      data: { clientId: "test-chatgpt", resourceId: resource, createdAt: new Date() },
    });
  });

  for (const redirectUri of redirectUris) {
    const { challenge } = pkcePair();
    const denied = await authorize(app, baseURL, redirectUri, challenge, resource, "check");
    expect(denied.status, await text(denied)).toBe(302);
    expect(new URL(denied.headers.get("location") ?? "", baseURL).pathname).toBe("/login");
  }

  const deniedCode = await oauthCode(app, baseURL, redirectUris[0]!, resource, false);
  expect(deniedCode).toBeNull();

  const allowed = await oauthCode(app, baseURL, redirectUris[0]!, resource, true);
  if (!allowed) throw new Error("allow did not return an authorization code");
  const token = await app.request("/api/auth/oauth2/token", {
    method: "POST",
    headers: { host: "127.0.0.1", "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: allowed.code,
      redirect_uri: redirectUris[0]!,
      client_id: "test-chatgpt",
      code_verifier: allowed.verifier,
      resource,
    }),
  });
  const tokenBody = (await token.json()) as { access_token?: string; error?: string };
  expect(token.status, JSON.stringify(tokenBody)).toBe(200);
  expect(typeof tokenBody.access_token).toBe("string");

  const listed = await app.request("/mcp", {
    method: "POST",
    headers: {
      host: "127.0.0.1",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${tokenBody.access_token}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(listed.status, await listed.clone().text()).toBe(200);
  server.stop(true);
  db.close();
});

function pkcePair() {
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function authorize(
  app: { request: (input: string, init?: RequestInit) => Promise<Response> },
  baseURL: string,
  redirectUri: string,
  challenge: string,
  resource: string,
  state: string,
) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: "test-chatgpt",
    redirect_uri: redirectUri,
    scope: "mcp",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
  });
  return app.request(`/api/auth/oauth2/authorize?${params}`, {
    headers: { host: "127.0.0.1", accept: "text/html" },
  });
}

async function oauthCode(
  app: Awaited<ReturnType<typeof testApp>>,
  baseURL: string,
  redirectUri: string,
  resource: string,
  accept: boolean,
) {
  const { verifier, challenge } = pkcePair();
  const started = await authorize(app, baseURL, redirectUri, challenge, resource, accept ? "allow" : "deny");
  const loginUrl = new URL(started.headers.get("location") ?? "", baseURL);
  const login = await app.request("/api/login", {
    method: "POST",
    headers: { host: "127.0.0.1", "content-type": "application/json" },
    body: JSON.stringify({ ...testOperator, oauth_query: loginUrl.search.slice(1) }),
  });
  const loginBody = (await login.json()) as { data?: { redirect?: string | null } };
  expect(login.status, JSON.stringify(loginBody)).toBe(200);
  const consentUrl = new URL(loginBody.data?.redirect ?? "", baseURL);
  expect(consentUrl.pathname).toBe("/consent");
  const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const consent = await app.request("/api/auth/oauth2/consent", {
    method: "POST",
    headers: { host: "127.0.0.1", "content-type": "application/json", accept: "application/json", cookie },
    body: JSON.stringify({ accept, oauth_query: consentUrl.search.slice(1) }),
  });
  const consentBody = (await consent.json()) as { url?: string };
  expect(consent.status, JSON.stringify(consentBody)).toBe(200);
  const next = new URL(consentBody.url ?? "", baseURL);
  if (!accept) {
    expect(next.searchParams.get("error")).toBe("access_denied");
    expect(next.searchParams.get("code")).toBeNull();
    return null;
  }
  const code = next.searchParams.get("code");
  expect(code).toBeTruthy();
  return { code: code ?? "", verifier };
}

async function text(response: Response) {
  return response.clone().text();
}
