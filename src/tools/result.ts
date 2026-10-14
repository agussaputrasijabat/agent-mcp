import { OUTPUT_CHAR_LIMIT } from "../limits.ts";

export type ToolResult = {
  content: [{ type: "text"; text: string }];
  isError?: boolean;
};

export function truncate(text: string, limit = OUTPUT_CHAR_LIMIT): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated]`;
}

export function ok(text: string): ToolResult {
  return { content: [{ type: "text", text: truncate(text) }] };
}

export function fail(code: string, message: string): ToolResult {
  return {
    content: [{ type: "text", text: truncate(`error ${code}: ${message}`) }],
    isError: true,
  };
}

export function notice(text: string, line: string): string {
  if (!text) return line;
  return `${text}\n${line}`;
}
