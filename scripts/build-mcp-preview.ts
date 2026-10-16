import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dir, "..");
const result = await Bun.build({
  entrypoints: [join(root, "web/src/mcp-preview.ts")],
  target: "browser", minify: true,
});
if (!result.success) throw new Error(result.logs.map(String).join("\n"));
const script = await result.outputs[0]!.text();
const css = `body{margin:0;color:var(--text,#17212f);font:14px system-ui;background:var(--bg,#fff)}header{display:flex;align-items:center;flex-wrap:wrap;gap:8px;padding:12px;border-bottom:1px solid #ddd}#title{min-width:150px;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:650;margin-right:auto}button{border:1px solid #c6cbd0;background:transparent;color:inherit;border-radius:7px;padding:6px 10px;cursor:pointer}button:hover{background:#e4e7eb}#preview{padding:16px;max-height:60vh;overflow:auto;overflow-wrap:anywhere}#preview img{max-width:100%;height:auto}pre{white-space:pre-wrap;word-break:break-word;font:12px/1.6 ui-monospace,monospace}textarea{display:block;width:calc(100% - 32px);min-height:40vh;margin:16px;font:13px/1.6 ui-monospace,monospace}#status{padding:10px 16px;color:#64748b}h1,h2,h3{line-height:1.3}code{background:#eee;padding:2px;border-radius:3px}#preview pre{padding:12px;border:1px solid #ddd;border-radius:8px;background:#fafafa}table{border-collapse:collapse;max-width:100%;display:block;overflow:auto}th,td{border:1px solid #d5dbe3;text-align:left;padding:6px 10px;white-space:pre-wrap;min-width:70px}th{font-weight:650;background:#edf2f7}details{padding:6px 0}summary{cursor:pointer;font-weight:650}@media(prefers-color-scheme:dark){body{--text:#eee;--bg:#151719}button:hover{background:#444}code,#preview pre{background:#222}}`;
const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><header><span id="title">File Preview</span><button id="toggle" hidden>Edit Markdown</button><button id="save" hidden>Save</button><button id="open">Open in Folder</button></header><main><div id="preview"></div><textarea id="editor" hidden></textarea></main><div id="status"></div><script>${script.replaceAll("</script", "<\\/script")}</script></body></html>`;
const destination = join(root, "dist/web/mcp-preview.html");
mkdirSync(join(root, "dist/web"), { recursive: true });
writeFileSync(destination, html);
console.log("built MCP Apps file preview", html.length);
