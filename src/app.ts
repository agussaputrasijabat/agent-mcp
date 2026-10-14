import { Hono } from "hono";
import type { Database } from "bun:sqlite";

export function createApp(db: Database): Hono {
  const app = new Hono();

  app.get("/health", (c) => {
    db.query("SELECT 1 AS ok").get();
    return c.json({ data: { ok: true }, error: null });
  });

  return app;
}
