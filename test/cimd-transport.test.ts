import * as dns from "node:dns/promises";
import * as https from "node:https";
import type { ClientRequest, IncomingMessage } from "node:http";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, expect, spyOn, test } from "bun:test";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { Database } from "bun:sqlite";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { createOperatorAuth } from "../src/auth/operator.ts";
import { openDatabase } from "../src/db/database.ts";
import { testApp, testOperator } from "./harness.ts";

type Address = { address: string; family: number };
const ipv4 = { address: "104.18.32.47", family: 4 };
const ipv6 = { address: "2606:4700:4408::ac40:9bd1", family: 6 };
const restore: (() => void)[] = [];

afterEach(() => { for (const cleanup of restore.splice(0).reverse()) cleanup(); });

function mockTransport(addresses: Address[], status = 200, body: object | ((url: URL) => object) = { client_name: "Test" }) {
  const allAddressDns: { lookup(host: string, options: { all: true; verbatim?: boolean }): Promise<Address[]> } = dns;
  const lookup = spyOn(allAddressDns, "lookup").mockResolvedValue(addresses);
  const connections: { url: URL; options: https.RequestOptions; pinned: unknown[] }[] = [];
  const request = spyOn(https, "request").mockImplementation(((url: URL, options: https.RequestOptions, respond: (response: IncomingMessage) => void) => {
    const pinned: unknown[] = [];
    const pinnedLookup = options.lookup as (
      host: string, options: { all: boolean }, callback: (error: null, result: unknown, family?: number) => void,
    ) => void;
    pinnedLookup(url.hostname, { all: true }, (_error, result) => pinned.push(result));
    pinnedLookup(url.hostname, { all: false }, (_error, address, family) => pinned.push({ address, family }));
    connections.push({ url, options, pinned });
    const outgoing = Object.assign(new EventEmitter(), {
      end() {
        const response = Object.assign(Readable.from([Buffer.from(JSON.stringify(typeof body === "function" ? body(url) : body))]), {
          statusCode: status,
          statusMessage: status === 200 ? "OK" : "Found",
          headers: { "content-type": "application/json", ...(status === 302 ? { location: "https://other.example/metadata" } : {}) },
        });
        respond(response as IncomingMessage);
        return outgoing;
      },
    });
    return outgoing as unknown as ClientRequest;
  }) as typeof https.request);
  restore.push(() => lookup.mockRestore(), () => request.mockRestore());
  return { lookup, request, connections };
}

test("cross-origin JWKS trust is limited to Google's metadata namespace and exact key URL", async () => {
  for (const [clientId, jwksUri] of [
    ["https://other.example/client.json", googleJwksUri],
    ["https://accountlinking.google.com/other/client.json", googleJwksUri],
    ["https://accountlinking.google.com.evil.example/clientidmetadata/user_bound_provider/test", googleJwksUri],
    [googleClientId, "https://other.example/jwks.json"],
    [googleClientId, "https://www.gstatic.com/other-keys.json"],
    [googleClientId, googleJwksUri + "?other=1"],
    [googleClientId, googleJwksUri.replace("www.gstatic.com", "www.gstatic.com:8443")],
  ]) {
    mockTransport([ipv4], 200, {
      client_id: clientId, client_name: "Untrusted metadata", redirect_uris: [googleRedirect],
      token_endpoint_auth_method: "private_key_jwt", jwks_uri: jwksUri,
      grant_types: ["authorization_code"], response_types: ["code"],
    });
    const db = new Database(":memory:");
    try {
      const auth = await createOperatorAuth(db, { secret: randomBytes(32).toString("hex"), baseURL: "http://127.0.0.1:3000" });
      const params = new URLSearchParams({
        response_type: "code", client_id: clientId!, redirect_uri: googleRedirect,
        scope: "mcp", code_challenge: "a".repeat(43), code_challenge_method: "S256",
        resource: "http://127.0.0.1:3000/mcp", state: "untrusted-jwks-test",
      });
      const response = await auth.handler(new Request(`http://127.0.0.1:3000/api/auth/oauth2/authorize?${params}`));
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("invalid_client_metadata");
      const context = await auth.$context;
      expect(context.isTrustedOrigin("https://www.gstatic.com")).toBe(false);
      expect(context.isTrustedOrigin(googleJwksUri)).toBe(false);
    } finally {
      db.close();
      for (const cleanup of restore.splice(0).reverse()) cleanup();
    }
  }
});

test("Gemini exchanges a PKCE authorization code using its cross-origin JWT signing keys", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwks = { keys: [{ ...publicKey.export({ format: "jwk" }), kid: "google-test-key", alg: "RS256", use: "sig" }] };
  const metadata = {
    client_id: googleClientId, client_name: "Google", redirect_uris: [googleRedirect],
    token_endpoint_auth_method: "private_key_jwt", token_endpoint_auth_signing_alg: "RS256",
    jwks_uri: googleJwksUri, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], scope: "mcp",
  };
  const transport = mockTransport([ipv6, ipv4], 200, (url) => url.href === googleJwksUri ? jwks : metadata);
  const db = openDatabase(":memory:");
  try {
    const baseURL = "http://127.0.0.1:3000";
    const app = await testApp(db);
    const verifier = randomBytes(32).toString("base64url");
    const state = "google-code-exchange-test-" + "s".repeat(2048);
    const params = new URLSearchParams({
      response_type: "code", client_id: googleClientId, redirect_uri: googleRedirect, scope: "mcp",
      code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
      resource: baseURL + "/mcp", state,
    });
    const started = await app.request("/api/auth/oauth2/authorize?" + params, { headers: { host: "127.0.0.1" } });
    expect(started.status).toBe(302);
    const loginQuery = new URL(started.headers.get("location")!, baseURL).search.slice(1);
    const login = await app.request("/api/login", {
      method: "POST", headers: { host: "127.0.0.1", "content-type": "application/json" },
      body: JSON.stringify({ ...testOperator, oauth_query: loginQuery }),
    });
    expect(login.status).toBe(200);
    const consentQuery = new URL((await login.json()).data.redirect, baseURL).search.slice(1);
    const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const consent = await app.request("/api/auth/oauth2/consent", {
      method: "POST",
      headers: { host: "127.0.0.1", origin: baseURL, "content-type": "application/json", cookie },
      body: JSON.stringify({ accept: true, oauth_query: consentQuery }),
    });
    expect(consent.status).toBe(200);
    const callback = new URL((await consent.json()).url);
    expect(callback.searchParams.get("state")).toBe(state);
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();

    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "google-test-key" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({
      iss: googleClientId, sub: googleClientId, aud: baseURL + "/api/auth/oauth2/token",
      iat: now, exp: now + 60, jti: randomBytes(16).toString("hex"),
    })).toString("base64url");
    const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), privateKey);
    const assertion = `${header}.${payload}.${signature.toString("base64url")}`;
    const exchange = (jwt: string) => app.request("/api/auth/oauth2/token", {
      method: "POST", headers: { host: "127.0.0.1", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code", code: code!, client_id: googleClientId,
        redirect_uri: googleRedirect, code_verifier: verifier, resource: baseURL + "/mcp",
        client_assertion_type: "urn:ietf:params:oauth:client-assertion-type:jwt-bearer", client_assertion: jwt,
      }),
    });
    signature[0] = signature[0]! ^ 1;
    const invalid = await exchange(`${header}.${payload}.${signature.toString("base64url")}`);
    expect(invalid.status).toBe(401);
    expect((await invalid.json()).error).toBe("invalid_client");
    const token = await exchange(assertion);
    const tokenBody = await token.json();
    expect(token.status, JSON.stringify(tokenBody)).toBe(200);
    expect(typeof tokenBody.access_token).toBe("string");
    expect(transport.connections.some(({ url }) => url.href === googleJwksUri)).toBe(true);
  } finally {
    db.close();
  }
});

test("CIMD prefers approved IPv4 when IPv6 DNS answers arrive first", async () => {
  const transport = mockTransport([ipv6, ipv4]);
  const signal = AbortSignal.timeout(1000);
  const response = await fetchClientMetadataResource("https://metadata.example/client.json", { signal });
  expect(await response.json()).toEqual({ client_name: "Test" });
  expect(transport.lookup).toHaveBeenCalledTimes(1);
  expect(transport.connections[0]?.pinned).toEqual([[ipv4], ipv4]);
  expect(transport.connections[0]?.options.headers).toMatchObject({ host: "metadata.example" });
  expect(transport.connections[0]?.options.servername).toBe("metadata.example");
  expect(transport.connections[0]?.options.agent).toBe(false);
  expect(transport.connections[0]?.options.signal).toBe(signal);
});

test("CIMD still supports public IPv6-only hosts", async () => {
  const transport = mockTransport([ipv6]);
  await fetchClientMetadataResource("https://metadata.example/client.json");
  expect(transport.connections[0]?.pinned).toEqual([[ipv6], ipv6]);
});

test("CIMD rejects every non-public DNS answer before connecting", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "fc00::1"]) {
    const transport = mockTransport([ipv4, { address, family: address.includes(":") ? 6 : 4 }]);
    await expect(fetchClientMetadataResource("https://metadata.example/client.json")).rejects.toThrow("public-routable");
    expect(transport.request).not.toHaveBeenCalled();
    for (const cleanup of restore.splice(0).reverse()) cleanup();
  }
});

test("CIMD returns redirects without following them", async () => {
  const transport = mockTransport([ipv4], 302);
  const response = await fetchClientMetadataResource("https://metadata.example/client.json");
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("https://other.example/metadata");
  expect(transport.request).toHaveBeenCalledTimes(1);
  await response.body?.cancel();
});

test("CIMD rejects HTTP and unsupported methods before resolving DNS", async () => {
  const transport = mockTransport([ipv4]);
  await expect(fetchClientMetadataResource("http://metadata.example/client.json")).rejects.toThrow("HTTPS");
  await expect(fetchClientMetadataResource("https://metadata.example/client.json", { method: "POST" })).rejects.toThrow("GET and HEAD");
  expect(transport.lookup).not.toHaveBeenCalled();
});

const googleJwksUri = "https://www.gstatic.com/account-linking/.well-known/client-assertion-signature-verification-key.json";
const googleClientId = "https://accountlinking.google.com/clientidmetadata/user_bound_provider/user_bound_custom-mcp-test-agent-mcp_example_com";
const googleRedirect = "https://oauth-redirect.googleusercontent.com/r/user_bound_custom-mcp-test-agent-mcp_example_com";

for (const client of [
  { name: "ChatGPT", id: "https://chatgpt.com/oauth/client.json", redirect: "https://chatgpt.com/connector_platform_oauth_redirect" },
  { name: "Claude", id: "https://claude.ai/oauth/mcp-oauth-client-metadata", redirect: "https://claude.ai/api/mcp/auth_callback" },
  { name: "Gemini", id: googleClientId, redirect: googleRedirect, jwksUri: googleJwksUri },
]) {
  test(`${client.name} metadata clients can authorize and reconnect with IPv6-first DNS`, async () => {
    const transport = mockTransport([ipv6, ipv4], 200, {
      client_id: client.id,
      client_name: client.name,
      redirect_uris: [client.redirect],
      token_endpoint_auth_method: client.jwksUri ? "private_key_jwt" : "none",
      ...(client.jwksUri ? { jwks_uri: client.jwksUri, token_endpoint_auth_signing_alg: "RS256" } : {}),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
    const db = new Database(":memory:");
    try {
      const auth = await createOperatorAuth(db, {
        secret: randomBytes(32).toString("hex"), baseURL: "http://127.0.0.1:3000",
      });
      const params = new URLSearchParams({
        response_type: "code", client_id: client.id, redirect_uri: client.redirect,
        scope: "mcp", code_challenge: "a".repeat(43), code_challenge_method: "S256",
        resource: "http://127.0.0.1:3000/mcp", state: "reconnect-test",
      });
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await auth.handler(new Request(`http://127.0.0.1:3000/api/auth/oauth2/authorize?${params}`));
        expect(response.status, await response.clone().text()).toBe(302);
        expect(response.headers.get("location")?.split("?")[0]).toBe("/login");
      }
      expect(transport.lookup).toHaveBeenCalledTimes(1);
      expect(transport.connections[0]?.pinned).toEqual([[ipv4], ipv4]);
    } finally {
      db.close();
    }
  });
}
