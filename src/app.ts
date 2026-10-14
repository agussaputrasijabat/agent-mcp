import type { Database } from "bun:sqlite";
import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import { createHostHandler } from "./mcp/handler.ts";
import { assertInstructions, readServerInstructions } from "./mcp/instructions.ts";

export type AppOptions = {
  instructions?: string;
  shellConcurrency?: number;
};

export function createApp(db: Database, options: AppOptions = {}) {
  const instructions = assertInstructions(options.instructions ?? readServerInstructions());
  const handler = createHostHandler({
    db,
    instructions,
    shellConcurrency: options.shellConcurrency,
  });
  const app = createMcpHonoApp({
    allowedHosts: ["localhost", "127.0.0.1"],
  });

  app.get("/health", (c) => {
    db.query("SELECT 1 AS ok").get();
    return c.json({ data: { ok: true }, error: null });
  });

  app.all("/mcp", (c) => handler.fetch(c.req.raw, { parsedBody: c.get("parsedBody") }));

  return app;
}
