import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createApiKey } from "../src/auth/keys.ts";
import { openDatabase } from "../src/db/database.ts";
import { testApp, testOperator } from "./harness.ts";
import { postMcp } from "./mcp-client.ts";

test("operator routes manage keys, clients, settings, memory, and skills", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-mcp-"));
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  const headers = { host: "127.0.0.1", "content-type": "application/json" };
  const anon = await app.request("/api/api-keys", { headers: { host: "127.0.0.1" } });
  expect(anon.status).toBe(401);

  const cookie = await signIn(app);
  const auth = { ...headers, cookie };
  const readHeaders = { host: "127.0.0.1", cookie };
  const emptyName = await app.request("/api/api-keys", { method: "POST", headers: auth, body: JSON.stringify({ name: "" }) });
  expect(emptyName.status).toBe(400);
  expect(((await emptyName.json()) as { error: { code: string } }).error.code).toBe("validation_error");

  const created = await app.request("/api/api-keys", { method: "POST", headers: auth, body: JSON.stringify({ name: "laptop" }) });
  expect(created.status).toBe(201);
  const createdBody = (await created.json()) as { data: { id: string; secret: string; key_prefix: string } };
  expect(createdBody.data.secret.startsWith("amcp_")).toBe(true);
  const listed = await app.request("/api/api-keys", { headers: readHeaders });
  const listedBody = (await listed.json()) as { data: { items: { secret?: string; key_prefix: string }[] } };
  expect(listedBody.data.items.some((item) => "secret" in item)).toBe(false);
  expect(listedBody.data.items[0]?.key_prefix).toBe(createdBody.data.key_prefix);

  const clients = await app.request("/api/clients", { headers: readHeaders });
  const clientsBody = (await clients.json()) as { data: { api_keys: { last_used_at: string | null }[]; oauth: unknown[] } };
  expect(clientsBody.data.api_keys.some((item) => item.last_used_at === null)).toBe(true);
  expect(clientsBody.data.oauth).toEqual([]);

  const revoked = await app.request(`/api/api-keys/${createdBody.data.id}/revoke`, { method: "POST", headers: auth, body: "{}" });
  expect(revoked.status).toBe(200);
  expect(((await revoked.json()) as { data: { revoked_at: string } }).data.revoked_at).toBeTruthy();
  const blocked = await postMcp(app, "tools/list", undefined, createdBody.data.secret);
  expect(blocked.status).toBe(401);

  const since = new Date().toISOString();
  for (let index = 0; index < 20; index += 1) {
    db.query(
      "INSERT INTO api_keys (id, name, key_prefix, key_hash, created_at) VALUES (?, ?, 'amcp_prefix00', ?, ?)",
    ).run(crypto.randomUUID(), `bulk-${index}`, `hash-${index}-${crypto.randomUUID()}`, since);
  }
  const limited = await app.request("/api/api-keys", { method: "POST", headers: auth, body: JSON.stringify({ name: "overflow" }) });
  expect(limited.status).toBe(429);

  const badUrl = await app.request("/api/settings", {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({ public_base_url: "http://203.0.113.5" }),
  });
  expect(badUrl.status).toBe(400);
  expect(((await badUrl.json()) as { error: { code: string } }).error.code).toBe("public_url_not_https");
  const badLimit = await app.request("/api/settings", {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({ shell_concurrency_limit: 0 }),
  });
  expect(((await badLimit.json()) as { error: { code: string } }).error.code).toBe("validation_error");
  const saved = await app.request("/api/settings", {
    method: "PATCH",
    headers: auth,
    body: JSON.stringify({ public_base_url: "https://mcp.example.com" }),
  });
  expect(saved.status).toBe(200);
  const settings = await app.request("/api/settings", { headers: readHeaders });
  expect(((await settings.json()) as { data: { public_base_url: string } }).data.public_base_url).toBe("https://mcp.example.com");

  const memory = await app.request("/api/memories", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ key: "tabs", body: "remember the tabs" }),
  });
  expect(memory.status).toBe(200);
  const badKey = await app.request("/api/memories", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ key: "Bad_Key", body: "nope" }),
  });
  expect(((await badKey.json()) as { error: { code: string } }).error.code).toBe("invalid_key");
  const key = createApiKey(db, "search");
  const found = await postMcp(app, "tools/call", { name: "memory_search", arguments: { query: "tabs" } }, key.secret);
  expect(found.body.result?.content?.[0]?.text).toContain("remember the tabs");

  const skill = await app.request("/api/skills", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ name: "review", description: "Review a diff", body: "Read the diff first." }),
  });
  expect(skill.status).toBe(200);
  const skillBody = await postMcp(app, "tools/call", { name: "skill_read", arguments: { name: "review" } }, key.secret);
  expect(skillBody.body.result?.content?.[0]?.text).toBe("Read the diff first.");
  const missing = await app.request("/api/skills/tidak-ada", { headers: readHeaders });
  expect(missing.status).toBe(404);

  rmSync(directory, { recursive: true, force: true });
  db.close();
});

async function signIn(app: { request: (input: string, init?: RequestInit) => Promise<Response> | Response }) {
  const response = await app.request("/api/login", {
    method: "POST",
    headers: { host: "127.0.0.1", "content-type": "application/json" },
    body: JSON.stringify(testOperator),
  });
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}
