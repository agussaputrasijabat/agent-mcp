import PizZip from "pizzip";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import * as z from "zod/v4";
import { codeFromErrno } from "./paths.ts";
import { fail, ok, type ToolResult } from "./result.ts";
import { documentPath, readDocument, writeDocument } from "./document-files.ts";
import { fingerprint, withDocumentLock } from "./document-safety.ts";

export const readDocxInput = z.object({ path: z.string(), limit: z.number().int().min(1).max(10000).default(100) });
export const createDocxInput = z.object({ path: z.string(), markdown: z.string().max(200_000) });
export const editDocxInput = z.object({ path: z.string(), old_string: z.string().min(1), new_string: z.string() });
export const searchDocxInput = z.object({ path: z.string(), query: z.string().min(1).max(500) });

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
function unescapeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos);/g, (_, key: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[key] ?? "");
}
function parseParagraphs(xml: string): string[] {
  const matches = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? [];
  return matches.map((p) => [...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map((m) => unescapeXml(m[1] ?? "")).join(""));
}
async function openDocx(path: string): Promise<{ zip: PizZip; xml: string; version: string }> {
  const bytes = await readDocument(path);
  const zip = new PizZip(bytes);
  const file = zip.file("word/document.xml");
  if (!file) throw new Error("invalid DOCX: word/document.xml missing");
  return { zip, xml: file.asText(), version: fingerprint(bytes) };
}
export async function readDocx(input: z.infer<typeof readDocxInput>): Promise<ToolResult> {
  const invalid = documentPath(input.path, ".docx");
  if (invalid) return invalid;
  try {
    const { xml } = await openDocx(input.path);
    const paragraphs = parseParagraphs(xml);
    return ok(JSON.stringify({ total_paragraphs: paragraphs.length, paragraphs: paragraphs.slice(0, input.limit) }));
  } catch (error) { return codeFromErrno(error); }
}
export async function createDocx(input: z.infer<typeof createDocxInput>): Promise<ToolResult> {
  const invalid = documentPath(input.path, ".docx");
  if (invalid) return invalid;
  try {
    const doc = new Document({
      sections: [{ children: input.markdown.split(/\r?\n/).map((line) => {
        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        return heading ? new Paragraph({ text: heading[2], heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][heading[1]!.length - 1] })
          : new Paragraph({ children: [new TextRun(line)] });
      }) }],
    });
    const bytes = await Packer.toBuffer(doc);
    const saveError = await writeDocument(input.path, bytes, false);
    return saveError ?? ok(`created DOCX ${input.path}`);
  } catch (error) { return codeFromErrno(error); }
}
export async function editDocx(input: z.infer<typeof editDocxInput>): Promise<ToolResult> {
  const invalid = documentPath(input.path, ".docx");
  if (invalid) return invalid;
  if (input.old_string === input.new_string) return fail("edit_noop", "old_string equals new_string");
  try {
    return await withDocumentLock(input.path, async () => {
    const { zip, xml, version } = await openDocx(input.path);
    const escaped = escapeXml(input.old_string);
    const occurrence = [...xml.matchAll(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g)]
      .filter((m) => m[0].includes(escaped));
    if (!occurrence.length) return fail("edit_not_found", "text not found inside a single XML text run; split-run edits are not supported");
    if (occurrence.length > 1 || occurrence[0]![0].split(escaped).length !== 2) return fail("edit_not_unique", "text appears more than once");
    const updated = xml.replace(occurrence[0]![0], occurrence[0]![0].replace(escaped, escapeXml(input.new_string)));
    zip.file("word/document.xml", updated);
    const bytes = zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
    const saveError = await writeDocument(input.path, bytes, true, version);
    return saveError ?? ok(`updated DOCX ${input.path}`);
    });
  } catch (error) { return codeFromErrno(error); }
}
export async function searchDocx(input: z.infer<typeof searchDocxInput>): Promise<ToolResult> {
  const invalid = documentPath(input.path, ".docx");
  if (invalid) return invalid;
  try {
    const { xml } = await openDocx(input.path);
    return ok(JSON.stringify({ matches: parseParagraphs(xml).map((text, index) => ({ paragraph: index + 1, text }))
      .filter((item) => item.text.toLowerCase().includes(input.query.toLowerCase())).slice(0, 100) }));
  } catch (error) { return codeFromErrno(error); }
}
