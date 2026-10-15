import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import { currentMcpRequest } from "../mcp/request-context.ts";
import { sensitivePath } from "../security/sensitive-path.ts";
import { truncate } from "../tools/result.ts";

const clientInfoKey = "io.modelcontextprotocol/clientInfo";
const resultLimit = 30_000;
const queryValue = /([?&](?:api_key|access_token|token)=)([^&#\s]*)/g;

export type ToolCallRow = {
  id: string;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  tool_name: string;
  arguments_json: string;
  result_text: string | null;
  is_error: number;
  error_code: string | null;
  client_name: string | null;
  client_version: string | null;
  auth_kind: string;
  auth_subject: string;
  session_key: string;
};

export type ToolMeta = {
  mcpReq?: {
    _meta?: Record<string, unknown>;
    envelope?: Record<string, unknown>;
  };
};

export type SessionRow = {
  session_key: string;
  last_started_at: string;
  call_count: number;
  error_count: number;
  last_tool_name: string;
};

export function beginToolCall(db: Database, input: {
  toolName: string;
  args: unknown;
  ctx?: ToolMeta;
  now?: Date;
}): string {
  const call = currentMcpRequest();
  const now = input.now ?? new Date();
  const id = crypto.randomUUID();
  const client = readClient(input.ctx);
  const secrets = redactSecrets(call?.request, call?.credential ?? "");
  const argumentsCopy = redactValue(input.args ?? {}, secrets) as Record<string, unknown>;
  if (["shell", "start_process", "execute_code"].includes(input.toolName)) {
    const field = input.toolName === "execute_code" ? "code" : "command";
    if (typeof argumentsCopy[field] === "string") {
      argumentsCopy[field] = `SHA-256: ${createHash("sha256").update(argumentsCopy[field]).digest("hex")} (${input.toolName === "shell" ? "command" : "source"} omitted)`;
    }
  }
  for (const field of ["input", "markdown", "cells", "rows", "old_string", "new_string"]) {
    if (field in argumentsCopy) argumentsCopy[field] = "[redacted]";
  }
  if ((input.toolName === "write_file" || input.toolName === "edit_file") &&
      typeof argumentsCopy.path === "string" && sensitivePath(argumentsCopy.path)) {
    if ("contents" in argumentsCopy) argumentsCopy.contents = "[redacted]";
    if ("old_string" in argumentsCopy) argumentsCopy.old_string = "[redacted]";
    if ("new_string" in argumentsCopy) argumentsCopy.new_string = "[redacted]";
  }
  db.query(
    `INSERT INTO tool_calls (
      id, started_at, finished_at, duration_ms, tool_name, arguments_json, result_text, is_error, error_code,
      client_name, client_version, auth_kind, auth_subject, session_key
    ) VALUES (?, ?, NULL, NULL, ?, ?, NULL, 0, NULL, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    now.toISOString(),
    input.toolName,
    JSON.stringify(argumentsCopy),
    client.name,
    client.version,
    call?.authKind ?? "api_key",
    call?.authSubject ?? "unknown",
    sessionKey(call?.request, call?.authKind ?? "api_key", call?.authSubject ?? "unknown", now),
  );
  return id;
}

export function finishToolCall(db: Database, id: string, result: { content?: { type?: string; text?: string }[]; isError?: boolean }, durationMs: number, now = new Date(), omitResult = false): void {
  const call = currentMcpRequest();
  const secrets = redactSecrets(call?.request, call?.credential ?? "");
  const output = (result.content ?? [])
    .filter((item) => item.type !== "image")
    .map((item) => item.text ?? "")
    .join("\n");
  const text = omitResult ? "[redacted: sensitive file]" : storeText(redactString(output, secrets));
  const isError = result.isError === true;
  db.query(
    `UPDATE tool_calls
     SET finished_at = ?, duration_ms = ?, result_text = ?, is_error = ?, error_code = ?
     WHERE id = ?`,
  ).run(now.toISOString(), Math.max(0, Math.round(durationMs)), text, isError ? 1 : 0, errorCode(text, isError), id);
}

export function getToolCall(db: Database, id: string): ToolCallRow | undefined {
  return (db.query("SELECT * FROM tool_calls WHERE id = ?").get(id) as ToolCallRow | null) ?? undefined;
}

export function listToolCalls(db: Database, query: {
  limit: number;
  cursor?: { startedAt: string; id: string };
  toolName?: string;
  sessionKey?: string;
}): { items: ToolCallRow[]; nextCursor: string | null } {
  const rows = db.query(
    `SELECT * FROM tool_calls
     WHERE (? IS NULL OR tool_name = ?)
       AND (? IS NULL OR session_key = ?)
       AND (? IS NULL OR started_at < ? OR (started_at = ? AND id < ?))
     ORDER BY started_at DESC, id DESC
     LIMIT ?`,
  ).all(
    query.toolName ?? null,
    query.toolName ?? null,
    query.sessionKey ?? null,
    query.sessionKey ?? null,
    query.cursor?.startedAt ?? null,
    query.cursor?.startedAt ?? null,
    query.cursor?.startedAt ?? null,
    query.cursor?.id ?? null,
    query.limit + 1,
  ) as ToolCallRow[];
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const nextCursor = rows.length > query.limit && last ? encodeCursor([last.started_at, last.id]) : null;
  return { items: page, nextCursor };
}

export function listSessions(db: Database, query: {
  limit: number;
  cursor?: { lastStartedAt: string; sessionKey: string };
}): { items: SessionRow[]; nextCursor: string | null } {
  const rows = db.query(
    `SELECT * FROM (
      SELECT
        session_key,
        MAX(started_at) AS last_started_at,
        COUNT(*) AS call_count,
        SUM(is_error) AS error_count,
        (
          SELECT tool_name FROM tool_calls latest
          WHERE latest.session_key = tool_calls.session_key
          ORDER BY latest.started_at DESC, latest.id DESC
          LIMIT 1
        ) AS last_tool_name
      FROM tool_calls
      GROUP BY session_key
    ) sessions
    WHERE (? IS NULL OR last_started_at < ? OR (last_started_at = ? AND session_key < ?))
    ORDER BY last_started_at DESC, session_key DESC
    LIMIT ?`,
  ).all(
    query.cursor?.lastStartedAt ?? null,
    query.cursor?.lastStartedAt ?? null,
    query.cursor?.lastStartedAt ?? null,
    query.cursor?.sessionKey ?? null,
    query.limit + 1,
  ) as SessionRow[];
  const page = rows.slice(0, query.limit).map((row) => ({
    ...row,
    call_count: Number(row.call_count),
    error_count: Number(row.error_count),
  }));
  const last = page.at(-1);
  const nextCursor = rows.length > query.limit && last ? encodeCursor([last.last_started_at, last.session_key]) : null;
  return { items: page, nextCursor };
}

export function encodeCursor(parts: string[]): string {
  return Buffer.from(JSON.stringify(parts)).toString("base64url");
}

export function decodeCursor(cursor: string): string[] | undefined {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some((part) => typeof part !== "string")) return undefined;
    return parsed as string[];
  } catch {
    return undefined;
  }
}

export function redactValue(value: unknown, secrets: string[]): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = redactValue(item, secrets);
    return out;
  }
  return value;
}

function redactSecrets(request: Request | undefined, credential: string): string[] {
  const values = [credential];
  const authorization = request?.headers.get("authorization");
  const apiKey = request?.headers.get("x-api-key");
  if (authorization) values.push(authorization);
  if (apiKey) values.push(apiKey);
  return values.filter((value) => value.length > 0).sort((left, right) => right.length - left.length);
}

function redactString(value: string, secrets: string[]): string {
  let next = value;
  for (const secret of secrets) next = next.split(secret).join("[redacted]");
  return next.replace(queryValue, "$1[redacted]");
}

function sessionKey(request: Request | undefined, authKind: string, authSubject: string, now: Date): string {
  const header = request?.headers.get("mcp-session-id");
  if (header) return header;
  return `auth:${authKind}:${authSubject}:${now.toISOString().slice(0, 10)}`;
}

function readClient(ctx: ToolMeta | undefined): { name: string | null; version: string | null } {
  const meta = ctx?.mcpReq?._meta ?? {};
  const envelope = ctx?.mcpReq?.envelope ?? {};
  const info = meta[clientInfoKey] ?? envelope[clientInfoKey];
  if (!info || typeof info !== "object") return { name: null, version: null };
  const record = info as { name?: unknown; version?: unknown };
  return {
    name: typeof record.name === "string" ? record.name : null,
    version: typeof record.version === "string" ? record.version : null,
  };
}

function storeText(text: string): string {
  const suffix = "\n[truncated]";
  if (text.length <= resultLimit) return text;
  if (text.endsWith(suffix) && text.length <= resultLimit + suffix.length) return text;
  return truncate(text, resultLimit);
}

function errorCode(text: string, isError: boolean): string | null {
  if (!isError) return null;
  return /^error ([a-z0-9_]+):/.exec(text)?.[1] ?? null;
}
