import { expect, test } from "bun:test";
import { decideMcpAuth } from "../src/auth/mcp-auth.ts";
import { createApiKey, revokeApiKey } from "../src/auth/keys.ts";
import { replaceOperatorPassword } from "../src/auth/operator.ts";
import { openDatabase } from "../src/db/database.ts";
import { testApp, testOperator } from "./harness.ts";

const headers = { host: "127.0.0.1", "content-type": "application/json" };

test("login rejects a bad password and accepts the operator", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  const wrong = await app.request("/api/login", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: testOperator.email, password: "not-the-password" }),
  });
  expect(wrong.status).toBe(401);
  expect(wrong.headers.get("set-cookie")).toBeNull();

  const right = await app.request("/api/login", {
    method: "POST",
    headers,
    body: JSON.stringify(testOperator),
  });
  expect(right.status).toBe(200);
  const cookie = right.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  const me = await app.request("/api/me", { headers: { host: "127.0.0.1", cookie } });
  expect(me.status).toBe(200);
  const anon = await app.request("/api/me", { headers: { host: "127.0.0.1" } });
  expect(anon.status).toBe(401);
  db.close();
});

test("login locks an address after ten failures", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  // app.request() has no socket, so clientIp is 127.0.0.1 for this in-process client.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await app.request("/api/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ email: testOperator.email, password: "not-the-password" }),
    });
    expect(response.status).toBe(401);
  }
  const blocked = await app.request("/api/login", {
    method: "POST",
    headers,
    body: JSON.stringify(testOperator),
  });
  expect(blocked.status).toBe(429);
  db.close();
});


test("native email sign-in locks an address after ten failures", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await app.request("/api/auth/sign-in/email", {
      method: "POST",
      headers,
      body: JSON.stringify({ email: testOperator.email, password: "not-the-password" }),
    });
    expect(response.status).toBe(401);
  }
  const blocked = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: testOperator.email, password: "not-the-password" }),
  });
  expect(blocked.status).toBe(429);
  db.close();
});

test("trusted proxy lockout uses the rightmost forwarded address", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db, { trustProxy: true });
  const locked = { ...headers, "x-forwarded-for": "203.0.113.9, 198.51.100.4" };
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await app.request("/api/login", {
      method: "POST",
      headers: locked,
      body: JSON.stringify({ email: testOperator.email, password: "not-the-password" }),
    });
    expect(response.status).toBe(401);
  }
  const blocked = await app.request("/api/login", {
    method: "POST",
    headers: locked,
    body: JSON.stringify(testOperator),
  });
  expect(blocked.status).toBe(429);
  const other = await app.request("/api/login", {
    method: "POST",
    headers: { ...headers, "x-forwarded-for": "203.0.113.9, 198.51.100.8" },
    body: JSON.stringify(testOperator),
  });
  expect(other.status).toBe(200);
  db.close();
});

test("login lockout follows the socket address when the proxy is not trusted", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db, { trustProxy: false });
  const peer = (address: string) => ({
    requestIP: () => ({ address, family: "IPv4" as const, port: 1 }),
  });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await app.request(
      "/api/login",
      {
        method: "POST",
        headers: { ...headers, "x-forwarded-for": "203.0.113.9" },
        body: JSON.stringify({ email: testOperator.email, password: "not-the-password" }),
      },
      peer("203.0.113.10"),
    );
    expect(response.status).toBe(401);
  }
  const blocked = await app.request(
    "/api/login",
    {
      method: "POST",
      headers: { ...headers, "x-forwarded-for": "198.51.100.8" },
      body: JSON.stringify(testOperator),
    },
    peer("203.0.113.10"),
  );
  expect(blocked.status).toBe(429);
  const other = await app.request(
    "/api/login",
    {
      method: "POST",
      headers: { ...headers, "x-forwarded-for": "203.0.113.9" },
      body: JSON.stringify(testOperator),
    },
    peer("203.0.113.11"),
  );
  expect(other.status).toBe(200);
  db.close();
});

test("public sign-up is closed", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  const response = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: "other@example.com", password: "passwordpassword", name: "Other" }),
  });
  expect(response.status).not.toBe(200);
  db.close();
});

test("mcp requires an api key in the header or query", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  const missing = await app.request("/mcp", {
    method: "POST",
    headers: { host: "127.0.0.1", "content-type": "application/json" },
    body: "{}",
  });
  expect(missing.status).toBe(401);
  expect(missing.headers.get("www-authenticate")).toContain("resource_metadata");

  const created = createApiKey(db, "laptop");
  const listed = await app.request("/mcp", {
    method: "POST",
    headers: {
      ...headers,
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${created.secret}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(listed.status).toBe(200);

  const queried = await app.request(`/mcp?api_key=${created.secret}`, {
    method: "POST",
    headers: { ...headers, accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(queried.status).toBe(200);

  revokeApiKey(db, created.row.id);
  const revoked = await app.request("/mcp", {
    method: "POST",
    headers: { ...headers, accept: "application/json, text/event-stream", authorization: `Bearer ${created.secret}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  expect(revoked.status).toBe(401);

  const queryToken = decideMcpAuth(new Request("http://127.0.0.1/mcp?access_token=abc"), db, "http://127.0.0.1:3000");
  expect(queryToken.ok).toBe(false);
  if (!queryToken.ok) expect(queryToken.code).toBe("query_token_rejected");

  const https = decideMcpAuth(new Request("http://203.0.113.5/mcp?api_key=amcp_example"), db, "http://203.0.113.5");
  expect(https.ok).toBe(false);
  if (!https.ok) expect(https.code).toBe("https_required");
  db.close();
});

test("reset password replaces the operator secret", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  await replaceOperatorPassword(db, "replacement-password");
  const response = await app.request("/api/login", {
    method: "POST",
    headers,
    body: JSON.stringify({ email: testOperator.email, password: "replacement-password" }),
  });
  expect(response.status).toBe(200);
  db.close();
});
