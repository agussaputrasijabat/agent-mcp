import { EmptyInstructionsError } from "./mcp/instructions.ts";
import { createApp } from "./app.ts";
import { openDatabase } from "./db/database.ts";

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? "3000");

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(JSON.stringify({ level: "error", msg: "invalid_port" }));
  process.exit(1);
}

const databasePath = process.env.DATABASE_PATH ?? "./data/agent.sqlite";
const db = openDatabase(databasePath);
let app;
try {
  app = createApp(db);
} catch (error) {
  if (error instanceof EmptyInstructionsError) process.exit(1);
  throw error;
}

Bun.serve({
  hostname: host,
  port,
  fetch: app.fetch,
});

console.log(JSON.stringify({ level: "info", msg: "listening", host, port }));
