import { Database } from "bun:sqlite";
import { createApp } from "../src/app.ts";
import { parseMcpBody } from "../src/mcp/message.ts";

const db = new Database(":memory:");
const app = createApp(db, { instructions: "schema probe" });
const response = await app.request("/mcp", {
  method: "POST",
  headers: {
    host: "127.0.0.1",
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
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
