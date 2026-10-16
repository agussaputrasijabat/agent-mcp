import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import * as z from "zod/v4";

const server = new McpServer({ name: "mock-cua", version: "1.0.0" });
server.registerTool("list_apps", {
  description: "Mock app list",
  inputSchema: {},
}, () => ({ content: [{ type: "text" as const, text: "Mock Calculator" }] }));
server.registerTool("get_window_state", {
  description: "Mock window state",
  inputSchema: z.object({ pid: z.number(), window_id: z.number() }),
}, () => ({ content: [
  { type: "text", text: "snapshot #1" },
  { type: "image", mimeType: "image/png", data: "iVBORw0KGgo=" },
] }));
server.registerTool("type_text", {
  description: "Mock typing",
  inputSchema: z.object({ text: z.string() }),
}, ({ text }) => ({ content: [{ type: "text", text: `typed ${text.length} characters` }] }));
server.registerTool("computer_screenshot", {
  description: "Image-only response",
  inputSchema: {},
}, () => ({ content: [{ type: "image" as const, mimeType: "image/png", data: "iVBORw0KGgo=" }] }));
await server.connect(new StdioServerTransport());
