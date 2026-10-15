import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { resourceText } from "../resources.ts";
import { previewFile, previewFileInput } from "../tools/file-preview.ts";
import { openInFolder, openInFolderInput } from "../tools/open-folder.ts";
import { sensitivePath } from "../security/sensitive-path.ts";
import type { Database } from "bun:sqlite";
import { beginToolCall, finishToolCall, type ToolMeta } from "../db/tool-calls.ts";
import { readSettings, type Settings } from "../db/settings.ts";
import type { ToolResult } from "../tools/result.ts";
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
import { createDirectory, createDirectoryInput, listDirectory, listDirectoryInput, movePath, movePathInput, statPath, statPathInput } from "../tools/filesystem-extra.ts";
import { ProcessSessions, startProcessInput, readProcessOutputInput, writeProcessInputInput, listProcessesInput, terminateProcessInput } from "../tools/process-sessions.ts";
import { executeCode, executeCodeInput } from "../tools/code-execution.ts";
import { readSpreadsheet, readSpreadsheetInput, createSpreadsheet, createSpreadsheetInput, editSpreadsheet, editSpreadsheetInput, searchSpreadsheet, searchSpreadsheetInput, analyzeDataInput, inspectTabular } from "../tools/spreadsheet.ts";
import { readPdf, readPdfInput, createPdf, createPdfInput, editPdf, editPdfInput } from "../tools/pdf.ts";
import { readDocx, readDocxInput, createDocx, createDocxInput, editDocx, editDocxInput, searchDocx, searchDocxInput } from "../tools/docx.ts";
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
  skillListInput,
  skillRead,
  skillReadInput,
  skillSave,
  skillSaveInput,
} from "../tools/skills.ts";
import { fetchUrl, webFetchInput } from "../tools/web-fetch.ts";
import { getInstructions, getInstructionsInput, instructionModes, readInstructionPack } from "./instructions.ts";

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

function traced<T>(db: Database, name: string, args: T, ctx: ToolMeta, run: () => ToolResult | Promise<ToolResult>) {
  const id = beginToolCall(db, { toolName: name, args, ctx });
  const started = Date.now();
  const candidate = args as Record<string, unknown>;
  const omitResult = ["shell", "start_process", "read_process_output", "write_process_input", "execute_code",
    "read_spreadsheet", "search_spreadsheet", "analyze_data", "read_pdf", "read_docx", "search_docx", "preview_file"].includes(name)
    || (typeof candidate.path === "string" && sensitivePath(candidate.path));
  return Promise.resolve()
    .then(run)
    .then((result) => {
      finishToolCall(db, id, result, Date.now() - started, new Date(), omitResult);
      return result;
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "tool failed";
      finishToolCall(db, id, { content: [{ text: message }], isError: true }, Date.now() - started, new Date(), omitResult);
      throw error;
    });
}

export function createHostHandler(options: {
  db: Database;
  instructions: string;
  shellConcurrency?: number;
  limits?: () => Pick<Settings, "shell_timeout_ms" | "shell_timeout_max_ms" | "shell_concurrency_limit">;
}) {
  const gate = new ShellGate(options.shellConcurrency ?? (() => options.limits?.().shell_concurrency_limit ?? SHELL_CONCURRENCY));
  const db = options.db;
  const processes = new ProcessSessions();
  const limits = options.limits ?? (() => readSettings(db));
  return createMcpHandler(() => {
    const serverInfo = {
      name: "agent-mcp",
      version: "1.0.0",
      instructions: options.instructions,
    };
    const server = new McpServer(serverInfo, { instructions: options.instructions });

    server.registerTool(
      "read_file",
      {
        description: "Read a UTF-8 file at an absolute path. Set include_hash=true before editing to obtain the SHA-256 expected_hash. Supported images are returned as images.",
        inputSchema: readFileInput,
        annotations: readOnly,
      },
      async (input, ctx) => traced(db, "read_file", input, ctx, () => readFile(input)),
    );
    server.registerTool(
      "write_file",
      {
        description: "Create or atomically replace a UTF-8 file. Use expected_hash from read_file to reject concurrent changes, or 'absent' for new files. The client decides whether to confirm this write action.",
        inputSchema: writeFileInput,
        annotations: writeAnnotations,
      },
      async (input, ctx) => traced(db, "write_file", input, ctx, () => writeFile(input)),
    );
    server.registerTool(
      "edit_file",
      { description: "Atomically replace one exact string in a UTF-8 file. Read with include_hash=true and pass expected_hash to prevent stale edits.", inputSchema: editFileInput, annotations: writeAnnotations },
      async (input, ctx) => traced(db, "edit_file", input, ctx, () => editFile(input)),
    );
    server.registerTool(
      "glob",
      { description: "Find files by a name pattern.", inputSchema: globInput, annotations: readOnly },
      async (input, ctx) => traced(db, "glob", input, ctx, () => findFiles(input)),
    );
    server.registerTool(
      "grep",
      { description: "Search UTF-8 file contents with a regex.", inputSchema: grepInput, annotations: readOnly },
      async (input, ctx) => traced(db, "grep", input, ctx, () => searchFiles(input)),
    );
    server.registerTool(
      "shell",
      {
        description: "Run a bash command on the host. Execute a Bash command on this host. Client-side tool confirmation applies according to ChatGPT or Claude permissions.",
        inputSchema: shellInput,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
      },
      async (input, ctx) =>
        traced(db, "shell", input, ctx, () =>
          runShell(input, gate, {
            timeoutMs: limits().shell_timeout_ms ?? SHELL_TIMEOUT_MS,
            timeoutMaxMs: limits().shell_timeout_max_ms ?? SHELL_TIMEOUT_MAX_MS,
          }),
        ),
    );
    server.registerTool("list_directory", { description: "List directory contents recursively with depth, offset, and limit. Does not follow symlinks.", inputSchema: listDirectoryInput, annotations: readOnly },
      async (input, ctx) => traced(db, "list_directory", input, ctx, () => listDirectory(input)));
    server.registerTool("create_directory", { description: "Create a directory, optionally including parent directories.", inputSchema: createDirectoryInput, annotations: upsertAnnotations },
      async (input, ctx) => traced(db, "create_directory", input, ctx, () => createDirectory(input)));
    server.registerTool("move_path", { description: "Move a file or folder. Refuses overwrite and symlink source.", inputSchema: movePathInput, annotations: writeAnnotations },
      async (input, ctx) => traced(db, "move_path", input, ctx, () => movePath(input)));
    server.registerTool("stat_path", { description: "Get file or directory metadata without following symlinks.", inputSchema: statPathInput, annotations: readOnly },
      async (input, ctx) => traced(db, "stat_path", input, ctx, () => statPath(input)));

    server.registerTool("start_process", { description: "Start a long-running host command with bounded output and a session ID. Client confirmation applies.", inputSchema: startProcessInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
      async (input, ctx) => traced(db, "start_process", input, ctx, () => processes.start(input)));
    server.registerTool("read_process_output", { description: "Read session output by character offset and length, with next_offset and status.", inputSchema: readProcessOutputInput, annotations: readOnly },
      async (input, ctx) => traced(db, "read_process_output", input, ctx, () => processes.read(input)));
    server.registerTool("write_process_input", { description: "Write input to a process session stdin.", inputSchema: writeProcessInputInput, annotations: writeAnnotations },
      async (input, ctx) => traced(db, "write_process_input", input, ctx, () => processes.write(input)));
    server.registerTool("list_processes", { description: "List process sessions owned by the current MCP identity.", inputSchema: listProcessesInput, annotations: readOnly },
      async (input, ctx) => traced(db, "list_processes", input, ctx, () => processes.list()));
    server.registerTool("terminate_process", { description: "Terminate a managed process session and its process group.", inputSchema: terminateProcessInput, annotations: deleteAnnotations },
      async (input, ctx) => traced(db, "terminate_process", input, ctx, () => processes.terminate(input)));

    server.registerTool("execute_code", { description: "Execute JavaScript, Python or R code without writing a source file. Requires the interpreter installed on host.", inputSchema: executeCodeInput,
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } },
      async (input, ctx) => traced(db, "execute_code", input, ctx, () => executeCode(input)));
    server.registerTool("analyze_data", { description: "Summarize column stats for CSV, JSON array or XLSX/XLSM.", inputSchema: analyzeDataInput, annotations: readOnly },
      async (input, ctx) => traced(db, "analyze_data", input, ctx, () => inspectTabular(input)));

    server.registerTool("read_spreadsheet", { description: "Read sheet metadata and rows from XLSX or XLSM, with row and range limit.", inputSchema: readSpreadsheetInput, annotations: readOnly },
      async (input, ctx) => traced(db, "read_spreadsheet", input, ctx, () => readSpreadsheet(input)));
    server.registerTool("create_spreadsheet", { description: "Create a new XLSX workbook; refuses to overwrite.", inputSchema: createSpreadsheetInput, annotations: writeAnnotations },
      async (input, ctx) => traced(db, "create_spreadsheet", input, ctx, () => createSpreadsheet(input)));
    server.registerTool("edit_spreadsheet", { description: "Edit XLSX cell values. XLSM writes are refused to preserve macros.", inputSchema: editSpreadsheetInput, annotations: writeAnnotations },
      async (input, ctx) => traced(db, "edit_spreadsheet", input, ctx, () => editSpreadsheet(input)));
    server.registerTool("search_spreadsheet", { description: "Find matching cell values across spreadsheet sheets.", inputSchema: searchSpreadsheetInput, annotations: readOnly },
      async (input, ctx) => traced(db, "search_spreadsheet", input, ctx, () => searchSpreadsheet(input)));

    server.registerTool("read_pdf", { description: "Extract text from PDF pages.", inputSchema: readPdfInput, annotations: readOnly },
      async (input, ctx) => traced(db, "read_pdf", input, ctx, () => readPdf(input)));
    server.registerTool("create_pdf", { description: "Create a PDF from basic Latin-1 Markdown text.", inputSchema: createPdfInput, annotations: writeAnnotations },
      async (input, ctx) => traced(db, "create_pdf", input, ctx, () => createPdf(input)));
    server.registerTool("edit_pdf", { description: "Append a PDF, delete pages, or rotate pages in an existing PDF.", inputSchema: editPdfInput, annotations: writeAnnotations },
      async (input, ctx) => traced(db, "edit_pdf", input, ctx, () => editPdf(input)));

    server.registerTool("read_docx", { description: "Read DOCX paragraphs while preserving source package.", inputSchema: readDocxInput, annotations: readOnly },
      async (input, ctx) => traced(db, "read_docx", input, ctx, () => readDocx(input)));
    server.registerTool("create_docx", { description: "Create DOCX with paragraphs and Markdown headings.", inputSchema: createDocxInput, annotations: writeAnnotations },
      async (input, ctx) => traced(db, "create_docx", input, ctx, () => createDocx(input)));
    server.registerTool("edit_docx", { description: "Surgically edit a unique single text run in DOCX XML without rebuilding the document.", inputSchema: editDocxInput, annotations: writeAnnotations },
      async (input, ctx) => traced(db, "edit_docx", input, ctx, () => editDocx(input)));
    server.registerTool("search_docx", { description: "Find text within DOCX paragraphs.", inputSchema: searchDocxInput, annotations: readOnly },
      async (input, ctx) => traced(db, "search_docx", input, ctx, () => searchDocx(input)));

    const previewUri = "ui://agent-mcp/file-preview";
    registerAppTool(server, "preview_file", {
      description: "Preview Markdown, text, images, spreadsheets, PDF and DOCX. Render an interactive MCP Apps view on capable clients.",
      inputSchema: previewFileInput,
      annotations: readOnly,
      _meta: { ui: { resourceUri: previewUri } },
    }, async (input, ctx) => traced(db, "preview_file", input, ctx, () => previewFile(input)));
    registerAppResource(server, previewUri, previewUri, { mimeType: RESOURCE_MIME_TYPE }, async () => ({
      contents: [{ uri: previewUri, mimeType: RESOURCE_MIME_TYPE, text: resourceText("dist/web/mcp-preview.html") }],
    }));
    server.registerTool("open_in_folder", { description: "Request the host desktop file manager to open or reveal a path.", inputSchema: openInFolderInput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
      async (input, ctx) => traced(db, "open_in_folder", input, ctx, () => openInFolder(input)));

    server.registerTool(
      "get_instructions",
      {
        description: "Return the full working instructions for this server. Call once at the start of every chat with the mode named in the project instructions: coding or general.",
        inputSchema: getInstructionsInput,
        annotations: readOnly,
      },
      async (input, ctx) => traced(db, "get_instructions", input, ctx, () => getInstructions(input)),
    );
    for (const mode of instructionModes) {
      server.registerPrompt(
        mode,
        { title: `agent-mcp ${mode} instructions`, description: `Working instructions for ${mode} work on this host.` },
        () => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text: readInstructionPack(mode).text } }] }),
      );
    }
    server.registerTool(
      "web_fetch",
      {
        description: "Fetch a public URL from the MCP host. Only use when the client's own web fetch cannot reach the URL or the host must fetch it; prefer the client's built-in fetch otherwise. Blocks localhost and private addresses.",
        inputSchema: webFetchInput,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      async (input, ctx) => traced(db, "web_fetch", input, ctx, () => fetchUrl(input)),
    );
    server.registerTool(
      "memory_search",
      { description: "Find saved notes by text.", inputSchema: memorySearchInput, annotations: readOnly },
      async (input, ctx) => traced(db, "memory_search", input, ctx, () => memorySearch(db, input)),
    );
    server.registerTool(
      "memory_save",
      { description: "Create or replace a note.", inputSchema: memorySaveInput, annotations: upsertAnnotations },
      async (input, ctx) => traced(db, "memory_save", input, ctx, () => memorySave(db, input)),
    );
    server.registerTool(
      "memory_forget",
      { description: "Delete one note by key.", inputSchema: memoryForgetInput, annotations: deleteAnnotations },
      async (input, ctx) => traced(db, "memory_forget", input, ctx, () => memoryForget(db, input)),
    );
    server.registerTool(
      "skill_list",
      {
        description: "List skill names and descriptions. Pass project_path to include read-only repo skills.",
        inputSchema: skillListInput,
        annotations: readOnly,
      },
      async (input, ctx) => traced(db, "skill_list", input, ctx, () => skillList(db, input)),
    );
    server.registerTool(
      "skill_read",
      {
        description: "Read one skill body. Pass source repo and project_path for a repo skill.",
        inputSchema: skillReadInput,
        annotations: readOnly,
      },
      async (input, ctx) => traced(db, "skill_read", input, ctx, () => skillRead(db, input)),
    );
    server.registerTool(
      "skill_save",
      {
        description: "Create or replace a database skill. Repo skills are read-only.",
        inputSchema: skillSaveInput,
        annotations: upsertAnnotations,
      },
      async (input, ctx) => traced(db, "skill_save", input, ctx, () => skillSave(db, input)),
    );
    server.registerTool(
      "skill_delete",
      {
        description: "Delete one database skill by name. Repo skills are read-only.",
        inputSchema: skillDeleteInput,
        annotations: deleteAnnotations,
      },
      async (input, ctx) => traced(db, "skill_delete", input, ctx, () => skillDelete(db, input)),
    );
    return server;
  });
}
