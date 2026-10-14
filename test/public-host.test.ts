import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { createApiKey } from "../src/auth/keys.ts";
import { openDatabase } from "../src/db/database.ts";
import { testApp } from "./harness.ts";

const publicHost = "agent-mcp-mac.aguslab.id";
const assetDir = join(import.meta.dir, "../dist/web/assets");
const assetPath = join(assetDir, "some.js");
const createdAsset = !existsSync(assetPath);

mkdirSync(assetDir, { recursive: true });
if (createdAsset) writeFileSync(assetPath, "console.log('ok')\n");

afterAll(() => {
  if (createdAsset) rmSync(assetPath, { force: true });
});

const listBody = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });

function mcpHeaders(host: string, apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    host,
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  return headers;
}

test("public host is rejected when PUBLIC_BASE_URL is loopback", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  const listed = await app.request("/mcp", { method: "POST", headers: mcpHeaders(publicHost, "amcp_unused"), body: listBody });
  expect(listed.status).toBe(403);
  expect(((await listed.json()) as { error: { message: string } }).error.message).toBe(`Invalid Host: ${publicHost}`);

  const asset = await app.request("/assets/some.js", { headers: { host: publicHost } });
  expect(asset.status).toBe(403);

  const local = await app.request("/assets/some.js", { headers: { host: "127.0.0.1" } });
  expect(local.status).toBe(200);
  db.close();
});

test("PUBLIC_BASE_URL admits the public host and auth still applies", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db, { baseURL: `https://${publicHost}` });
  const anon = await app.request("/mcp", { method: "POST", headers: mcpHeaders(publicHost), body: listBody });
  expect(anon.status).toBe(401);

  const key = createApiKey(db, "laptop");
  const listed = await app.request("/mcp", {
    method: "POST",
    headers: { ...mcpHeaders(publicHost, key.secret), origin: `https://${publicHost}` },
    body: listBody,
  });
  expect(listed.status).toBe(200);

  const asset = await app.request("/assets/some.js", {
    headers: { host: publicHost, origin: `https://${publicHost}` },
  });
  expect(asset.status).toBe(200);

  const favicon = await app.request("/favicon.svg", { headers: { host: publicHost } });
  expect(favicon.status).toBe(200);

  const home = await app.request("/", { headers: { host: publicHost } });
  expect(home.status).toBe(302);
  expect(home.headers.get("location")).toBe("/login");

  const loopback = await app.request("/mcp", { method: "POST", headers: mcpHeaders("127.0.0.1"), body: listBody });
  expect(loopback.status).toBe(401);
  db.close();
});

test("ALLOWED_HOSTS admits a host that differs from PUBLIC_BASE_URL", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db, { allowedHosts: publicHost });
  const asset = await app.request("/assets/some.js", { headers: { host: publicHost } });
  expect(asset.status).toBe(200);
  const crossSite = await app.request("/assets/some.js", {
    headers: { host: publicHost, origin: "https://evil.example" },
  });
  expect(crossSite.status).toBe(403);
  const anon = await app.request("/mcp", { method: "POST", headers: mcpHeaders(publicHost), body: listBody });
  expect(anon.status).toBe(401);
  db.close();
});
