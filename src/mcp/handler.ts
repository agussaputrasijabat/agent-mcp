import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { SHELL_CONCURRENCY } from "../limits.ts";
import {
  editFile,
  editFileInput,
  findFiles,
  globInput,
  grepInput,
  readFile,
  readFileInput,
  searchFiles,
  writeFile,
  writeFileInput,
} from "../tools/files.ts";
import { runShell, ShellGate, shellInput } from "../tools/shell.ts";
import { fetchUrl, webFetchInput } from "../tools/web-fetch.ts";

const readOnly = { readOnlyHint: true } as const;
const writeAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

export function createHostHandler(options: { instructions: string; shellConcurrency?: number }) {
  const gate = new ShellGate(options.shellConcurrency ?? SHELL_CONCURRENCY);
  return createMcpHandler(() => {
    const server = new McpServer({
      name: "agent-mcp",
      version: "1.0.0",
      instructions: options.instructions,
    });

    server.registerTool(
      "read_file",
      { description: "Read a UTF-8 file at an absolute path.", inputSchema: readFileInput, annotations: readOnly },
      async (input) => readFile(input),
    );
    server.registerTool(
      "write_file",
      { description: "Create or replace a UTF-8 file at an absolute path.", inputSchema: writeFileInput, annotations: writeAnnotations },
      async (input) => writeFile(input),
    );
    server.registerTool(
      "edit_file",
      { description: "Replace one exact string in a UTF-8 file.", inputSchema: editFileInput, annotations: writeAnnotations },
      async (input) => editFile(input),
    );
    server.registerTool(
      "glob",
      { description: "Find files by a name pattern.", inputSchema: globInput, annotations: readOnly },
      async (input) => findFiles(input),
    );
    server.registerTool(
      "grep",
      { description: "Search UTF-8 file contents with a regex.", inputSchema: grepInput, annotations: readOnly },
      async (input) => searchFiles(input),
    );
    server.registerTool(
      "shell",
      {
        description: "Run a bash command on the MCP host.",
        inputSchema: shellInput,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      },
      async (input) => runShell(input, gate),
    );
    server.registerTool(
      "web_fetch",
      {
        description: "Fetch an HTTP or HTTPS URL and return text.",
        inputSchema: webFetchInput,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async (input) => fetchUrl(input),
    );
    return server;
  });
}
