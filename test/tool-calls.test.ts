import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { createApiKey } from "../src/auth/keys.ts";
import { beginToolCall, getToolCall } from "../src/db/tool-calls.ts";
import { openDatabase } from "../src/db/database.ts";
import { testApp, testOperator } from "./harness.ts";
import { postMcp } from "./mcp-client.ts";

test("tool_calls stores a finished read and redacts the live secret", async () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-mcp-"));
  const file = join(directory, "note.txt");
  await Bun.write(file, "hello");
  const db = openDatabase(":memory:");
  const app = await testApp(db);
  const created = createApiKey(db, "laptop");
  const read = await postMcp(app, "tools/call", {
    name: "read_file",
    arguments: { path: file },
    _meta: { "io.modelcontextprotocol/clientInfo": { name: "chatgpt", version: "1.2.3" } },
  }, created.secret);
  expect(read.status).toBe(200);
  const rows = db.query("SELECT * FROM tool_calls").all() as { finished_at: string | null; is_error: number; client_name: string | null; client_version: string | null }[];
  expect(rows).toHaveLength(1);
  expect(rows[0]?.finished_at).toBeTruthy();
  expect(rows[0]?.is_error).toBe(0);
  expect(rows[0]?.client_name).toBe("chatgpt");
  expect(rows[0]?.client_version).toBe("1.2.3");

  const echoed = await app.request("/mcp", {
    method: "POST",
    headers: {
      host: "127.0.0.1",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${created.secret}`,
      "mcp-session-id": "chat-a",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "shell", arguments: { command: `printf '%s' '${created.secret}'` } },
    }),
  });
  expect(echoed.status).toBe(200);
  const echoedText = await echoed.text();
  expect(echoedText.includes(created.secret)).toBe(true);
  const stored = db.query("SELECT arguments_json, session_key FROM tool_calls WHERE tool_name = 'shell'").get() as {
    arguments_json: string;
    session_key: string;
  };
  expect(stored.arguments_json.includes(created.secret)).toBe(false);
  expect(stored.arguments_json.includes("[redacted]")).toBe(true);
  expect(stored.session_key).toBe("chat-a");

  await app.request("/mcp", {
    method: "POST",
    headers: {
      host: "127.0.0.1",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "x-api-key": created.secret,
      "mcp-session-id": "chat-a",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "shell", arguments: { command: "printf '%s' 'https://example.test/?api_key=other-value&token=zzz'" } },
    }),
  });
  const latest = db.query("SELECT arguments_json FROM tool_calls WHERE arguments_json LIKE '%example.test%'").get() as { arguments_json: string };
  expect(latest.arguments_json.includes("other-value")).toBe(false);
  expect(latest.arguments_json.includes("zzz")).toBe(false);
  expect(latest.arguments_json.includes("[redacted]")).toBe(true);

  const cookie = await signIn(app);
  const anon = await app.request("/api/sessions", { headers: { host: "127.0.0.1" } });
  expect(anon.status).toBe(401);
  const grouped = await app.request("/api/sessions?limit=50", { headers: { host: "127.0.0.1", cookie } });
  const groupedBody = (await grouped.json()) as { data: { items: { session_key: string; call_count: number }[] } };
  expect(groupedBody.data.items.find((item) => item.session_key === "chat-a")?.call_count).toBe(2);

  const first = await app.request("/api/sessions?limit=1", { headers: { host: "127.0.0.1", cookie } });
  expect(first.status).toBe(200);
  const firstBody = (await first.json()) as { data: { items: { session_key: string }[]; next_cursor: string | null } };
  expect(firstBody.data.items).toHaveLength(1);
  const second = await app.request(`/api/sessions?limit=1&cursor=${firstBody.data.next_cursor}`, {
    headers: { host: "127.0.0.1", cookie },
  });
  const secondBody = (await second.json()) as { data: { items: { session_key: string }[] } };
  expect(secondBody.data.items.some((item) => item.session_key === firstBody.data.items[0]?.session_key)).toBe(false);

  const feed = await app.request("/", { headers: { host: "127.0.0.1", cookie } });
  const html = await feed.text();
  expect(html).toContain("Belum ada panggilan tool.");
  expect(html).toContain("Feed gagal dimuat.");
  expect(html).toContain("Coba lagi");
  expect(html).toContain("1000");
  const missing = await app.request("/sessions/tidak-ada", { headers: { host: "127.0.0.1", cookie } });
  expect(await missing.text()).toContain("Sesi ini tidak punya panggilan.");
  rmSync(directory, { recursive: true, force: true });
  db.close();
});

test("tool_calls keeps an unfinished row after the database reopens", () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-mcp-"));
  const databasePath = join(directory, "agent.sqlite");
  const db = openDatabase(databasePath);
  const id = beginToolCall(db, { toolName: "shell", args: { command: "sleep 5" } });
  db.close();
  const again = openDatabase(databasePath);
  const row = getToolCall(again, id);
  expect(row?.finished_at).toBeNull();
  again.close();
  rmSync(directory, { recursive: true, force: true });
});

async function signIn(app: { request: (input: string, init?: RequestInit) => Promise<Response> }) {
  const response = await app.request("/api/login", {
    method: "POST",
    headers: { host: "127.0.0.1", "content-type": "application/json" },
    body: JSON.stringify(testOperator),
  });
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}
