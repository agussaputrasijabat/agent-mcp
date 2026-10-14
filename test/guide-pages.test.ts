import { expect, test } from "bun:test";
import { openDatabase } from "../src/db/database.ts";
import { testApp, testOperator } from "./harness.ts";

const guidePaths = ["/docs", "/setup"];

test("docs and setup require a session the same way as /keys, and tutorial redirects to docs", async () => {
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  const headers = { host: "127.0.0.1" };
  for (const path of guidePaths) {
    const anon = await app.request(path, { headers });
    expect(anon.status).toBe(302);
    expect(anon.headers.get("location")).toBe("/login");
  }
  const anonTutorial = await app.request("/tutorial", { headers });
  expect(anonTutorial.status).toBe(302);
  expect(anonTutorial.headers.get("location")).toBe("/docs");

  const cookie = await signIn(app);
  const authed = { ...headers, cookie };
  const keys = await app.request("/keys", { headers: authed });
  for (const path of guidePaths) {
    const response = await app.request(path, { headers: authed });
    expect(response.status).toBe(keys.status);
    expect(response.headers.get("content-type")).toBe(keys.headers.get("content-type"));
  }
  const tutorial = await app.request("/tutorial", { headers: authed });
  expect(tutorial.status).toBe(302);
  expect(tutorial.headers.get("location")).toBe("/docs");

  const login = await app.request("/login", { headers });
  expect(login.status).toBe(keys.status);
  expect(login.headers.get("location")).toBeNull();
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
