import { createApiKey } from "../src/auth/keys.ts";
import { openDatabase } from "../src/db/database.ts";
import { parseMcpBody } from "../src/mcp/message.ts";
import { testApp } from "../test/harness.ts";

const db = openDatabase(":memory:");
const app = await testApp(db, { instructions: "schema probe" });
const key = createApiKey(db, "schema").secret;
const response = await app.request("/mcp", {
  method: "POST",
  headers: {
    host: "127.0.0.1",
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${key}`,
  },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
});
const body = parseMcpBody(await response.text()) as { result?: { tools?: unknown } };
const tools = body.result?.tools;
if (!tools) {
  console.error("tools/list did not return tools");
  process.exit(1);
}
const tokens = Math.ceil(Buffer.byteLength(JSON.stringify(tools)) / 4);
console.log(tokens);
if (tokens > 4000) {
  console.error("schema token estimate is over 4000");
  process.exit(1);
}
