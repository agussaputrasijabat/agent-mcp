import { OUTPUT_CHAR_LIMIT } from "../limits.ts";

export type TextContent = { type: "text"; text: string };
export type ImageContent = { type: "image"; data: string; mimeType: string };

export type ToolResult = {
  content: [TextContent, ...ImageContent[]];
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

export function imageResult(text: string, data: string, mimeType: string): ToolResult {
  return {
    content: [
      { type: "text", text },
      { type: "image", data, mimeType },
    ],
  };
}

export function notice(text: string, line: string): string {
  if (!text) return line;
  return `${text}\n${line}`;
}
