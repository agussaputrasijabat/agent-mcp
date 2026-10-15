import { homedir } from "node:os";
import { join } from "node:path";

export function dataDirectory(): string {
  if (process.env.AGENT_MCP_HOME) return process.env.AGENT_MCP_HOME;
  if (process.platform === "darwin") return join(homedir(), "Library/Application Support/agent-mcp");
  if (process.platform === "win32") return join(process.env.APPDATA ?? join(homedir(), "AppData/Roaming"), "agent-mcp");
  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share"), "agent-mcp");
}
