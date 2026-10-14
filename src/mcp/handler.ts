import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { Database } from "bun:sqlite";
import { readSettings, type Settings } from "../db/settings.ts";
import { SHELL_CONCURRENCY, SHELL_TIMEOUT_MAX_MS, SHELL_TIMEOUT_MS } from "../limits.ts";
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
import {
  memoryForget,
  memoryForgetInput,
  memorySave,
  memorySaveInput,
  memorySearch,
  memorySearchInput,
} from "../tools/memory.ts";
import { runShell, ShellGate, shellInput } from "../tools/shell.ts";
import {
  skillDelete,
  skillDeleteInput,
  skillList,
  skillRead,
  skillReadInput,
  skillSave,
  skillSaveInput,
} from "../tools/skills.ts";
import { fetchUrl, webFetchInput } from "../tools/web-fetch.ts";

const readOnly = { readOnlyHint: true } as const;
const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
} as const;
const upsertAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;
const deleteAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function createHostHandler(options: {
  db: Database;
  instructions: string;
  shellConcurrency?: number;
  limits?: () => Pick<Settings, "shell_timeout_ms" | "shell_timeout_max_ms" | "shell_concurrency_limit">;
}) {
  const gate = new ShellGate(options.shellConcurrency ?? (() => options.limits?.().shell_concurrency_limit ?? SHELL_CONCURRENCY));
  const db = options.db;
  const limits = options.limits ?? (() => readSettings(db));
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
      {
        description: "Create or replace a UTF-8 file at an absolute path.",
        inputSchema: writeFileInput,
        annotations: writeAnnotations,
      },
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
      async (input) =>
        runShell(input, gate, {
          timeoutMs: limits().shell_timeout_ms ?? SHELL_TIMEOUT_MS,
          timeoutMaxMs: limits().shell_timeout_max_ms ?? SHELL_TIMEOUT_MAX_MS,
        }),
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
    server.registerTool(
      "memory_search",
      { description: "Find saved notes by text.", inputSchema: memorySearchInput, annotations: readOnly },
      async (input) => memorySearch(db, input),
    );
    server.registerTool(
      "memory_save",
      { description: "Create or replace a note.", inputSchema: memorySaveInput, annotations: upsertAnnotations },
      async (input) => memorySave(db, input),
    );
    server.registerTool(
      "memory_forget",
      { description: "Delete one note by key.", inputSchema: memoryForgetInput, annotations: deleteAnnotations },
      async (input) => memoryForget(db, input),
    );
    server.registerTool("skill_list", { description: "List skill names and descriptions.", annotations: readOnly }, async () =>
      skillList(db),
    );
    server.registerTool(
      "skill_read",
      { description: "Read one skill body.", inputSchema: skillReadInput, annotations: readOnly },
      async (input) => skillRead(db, input),
    );
    server.registerTool(
      "skill_save",
      { description: "Create or replace a skill.", inputSchema: skillSaveInput, annotations: upsertAnnotations },
      async (input) => skillSave(db, input),
    );
    server.registerTool(
      "skill_delete",
      { description: "Delete one skill by name.", inputSchema: skillDeleteInput, annotations: deleteAnnotations },
      async (input) => skillDelete(db, input),
    );
    return server;
  });
}
