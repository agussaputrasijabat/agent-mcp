import type { Hono } from "hono";
import { parseMcpBody } from "../src/mcp/message.ts";

export async function postMcp(app: Hono, method: string, params?: Record<string, unknown>) {
  const response = await app.request("/mcp", {
    method: "POST",
    headers: {
      host: "127.0.0.1",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const text = await response.text();
  return { status: response.status, body: parseMcpBody(text) as McpBody };
}

type McpBody = {
  result?: {
    tools?: { name: string; annotations?: Record<string, boolean> }[];
    serverInfo?: { instructions?: string };
    content?: { type: string; text: string }[];
    isError?: boolean;
  };
  error?: { message?: string };
};
