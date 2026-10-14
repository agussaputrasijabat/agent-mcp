import type { SessionRow, ToolCallRow } from "../db/tool-calls.ts";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    if (char === "&") return "&amp;";
    if (char === "<") return "&lt;";
    if (char === ">") return "&gt;";
    if (char === '"') return "&quot;";
    return "&#39;";
  });
}

const style = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #09090b; color: #fafafa; font-family: ui-sans-serif, system-ui, sans-serif; }
  main { max-width: 960px; margin: 24px auto; background: #18181b; border-radius: 12px; padding: 24px; }
  a { color: #fafafa; }
  td, th { height: 40px; text-align: left; padding: 0 8px; }
  p { color: #a1a1aa; }
`;

export function sessionsPage(items: SessionRow[]): string {
  const body = items.length === 0
    ? ""
    : `<table>
        ${items
          .map(
            (item) => `<tr>
              <td><a href="/sessions/${encodeURIComponent(item.session_key)}">${escapeHtml(item.session_key)}</a></td>
              <td>${escapeHtml(item.last_started_at)}</td>
              <td>${item.call_count}</td>
              <td>${item.error_count}</td>
              <td>${escapeHtml(item.last_tool_name)}</td>
            </tr>`,
          )
          .join("")}
      </table>`;
  return `<!doctype html>
<html lang="id">
  <head><meta charset="utf-8" /><title>Sesi</title><style>${style}</style></head>
  <body><main><h1>Sesi</h1>${body}</main></body>
</html>`;
}

export function sessionDetailPage(sessionKey: string, calls: ToolCallRow[]): string {
  const body = calls.length === 0
    ? `<p>Sesi ini tidak punya panggilan.</p>`
    : `<table>
        ${calls
          .map(
            (call) => `<tr><td>${escapeHtml(call.tool_name)}</td><td>${escapeHtml(call.started_at)}</td><td>${call.is_error}</td></tr>`,
          )
          .join("")}
      </table>`;
  return `<!doctype html>
<html lang="id">
  <head><meta charset="utf-8" /><title>Sesi</title><style>${style}</style></head>
  <body><main><h1>${escapeHtml(sessionKey)}</h1>${body}</main></body>
</html>`;
}
