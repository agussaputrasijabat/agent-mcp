import { App } from "@modelcontextprotocol/ext-apps";
import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";
import { isStructuredDocument } from "./preview-kind.ts";

const app = new App({ name: "Agent MCP File Preview", version: "1.0.0" });
const markdown = new MarkdownIt({ html: false, linkify: false });
const title = document.getElementById("title")!;
const preview = document.getElementById("preview")!;
const editor = document.getElementById("editor") as HTMLTextAreaElement;
const toggle = document.getElementById("toggle") as HTMLButtonElement;
const save = document.getElementById("save") as HTMLButtonElement;
const open = document.getElementById("open") as HTMLButtonElement;
const status = document.getElementById("status")!;
let path = "";
let hash: string | undefined;
let content = "";
let editable = false;
let editing = false;

function note(message: string): void { status.textContent = message; }

function showResult(result: { content?: { type?: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean }): void {
  if (result.isError) {
    note(result.content?.[0]?.text ?? "Failed to read file");
    return;
  }
  const image = result.content?.find((part) => part.type === "image");
  const text = result.content?.find((part) => part.type === "text")?.text ?? "";
  preview.replaceChildren();
  editor.hidden = true;
  preview.hidden = false;
  editing = false;
  save.hidden = true;
  hash = undefined;
  if (image?.data) {
    const img = document.createElement("img");
    img.alt = path;
    img.src = `data:${image.mimeType || "image/png"};base64,${image.data}`;
    preview.append(img);
  } else if (/\.(md|markdown)$/i.test(path)) {
    const match = text.match(/^sha256 ([a-f0-9]{64})\n/);
    hash = match?.[1];
    content = match ? text.slice(match[0].length) : text;
    preview.innerHTML = DOMPurify.sanitize(markdown.render(content));
    editable = Boolean(hash);
    toggle.hidden = !editable;
  } else {
    content = text;
    editable = false;
    toggle.hidden = true;
    if (!showStructured(text)) {
      const pre = document.createElement("pre");
      pre.textContent = text;
      preview.append(pre);
    }
  }
  note("Ready");
}
function showStructured(text: string): boolean {
  if (!isStructuredDocument(path)) return false;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch { return false; }
  if (Array.isArray(data.rows)) {
    const caption = document.createElement("p");
    caption.textContent = `Worksheet: ${String(data.selected ?? "")}`;
    preview.append(caption);
    const table = document.createElement("table");
    for (const [i, row] of data.rows.entries()) {
      if (!Array.isArray(row)) continue;
      const tr = document.createElement("tr");
      for (const val of row) {
        const cell = document.createElement(i === 0 ? "th" : "td");
        cell.textContent = val === null || val === undefined ? "" : typeof val === "object" ? JSON.stringify(val) : String(val);
        tr.append(cell);
      }
      table.append(tr);
    }
    preview.append(table);
    return true;
  }
  if (Array.isArray(data.paragraphs)) {
    for (const paragraph of data.paragraphs) {
      const p = document.createElement("p");
      p.textContent = String(paragraph);
      preview.append(p);
    }
    return true;
  }
  if (Array.isArray(data.pages)) {
    for (const item of data.pages) {
      if (!item || typeof item !== "object") continue;
      const page = item as { page?: number; text?: string };
      const details = document.createElement("details");
      details.open = true;
      const heading = document.createElement("summary");
      heading.textContent = `Page ${page.page ?? "?"}`;
      const pre = document.createElement("pre");
      pre.textContent = page.text ?? "";
      details.append(heading, pre);
      preview.append(details);
    }
    return true;
  }
  return false;
}
app.ontoolinput = (input) => {
  const args = input.arguments as { path?: unknown } | undefined;
  path = typeof args?.path === "string" ? args.path : "";
  title.textContent = path || "File Preview";
};
app.ontoolresult = showResult;
toggle.addEventListener("click", () => {
  if (!editable) return;
  editing = !editing;
  editor.hidden = !editing;
  preview.hidden = editing;
  save.hidden = !editing;
  toggle.textContent = editing ? "Cancel edit" : "Edit Markdown";
  if (editing) editor.value = content;
});
save.addEventListener("click", async () => {
  if (!hash || !path) return;
  note("Saving...");
  try {
    const result = await app.callServerTool({
      name: "write_file", arguments: { path, contents: editor.value, expected_hash: hash },
    });
    if (result.isError) { note(result.content?.find((part) => part.type === "text")?.text ?? "Save failed"); return; }
    const updated = await app.callServerTool({ name: "preview_file", arguments: { path } });
    showResult(updated);
    toggle.textContent = "Edit Markdown";
    note("Saved");
  } catch (error) { note(error instanceof Error ? error.message : "Save failed"); }
});
open.addEventListener("click", async () => {
  if (!path) return;
  try {
    const result = await app.callServerTool({ name: "open_in_folder", arguments: { path } });
    note(result.content?.find((part) => part.type === "text")?.text ?? "Requested");
  } catch (error) { note(error instanceof Error ? error.message : "Cannot open folder"); }
});
void app.connect();
