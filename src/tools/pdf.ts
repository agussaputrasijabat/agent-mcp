import { PDFDocument, StandardFonts, rgb, degrees } from "pdf-lib";
import { extractText, getDocumentProxy } from "unpdf";
import * as z from "zod/v4";
import { codeFromErrno } from "./paths.ts";
import { fail, ok, type ToolResult } from "./result.ts";
import { documentPath, readDocument, writeDocument } from "./document-files.ts";
import { fingerprint, withDocumentLock } from "./document-safety.ts";

export const readPdfInput = z.object({
  path: z.string(), start_page: z.number().int().min(1).default(1),
  end_page: z.number().int().min(1).optional(),
});
export const createPdfInput = z.object({ path: z.string(), markdown: z.string().max(200_000) });
export const editPdfInput = z.object({
  path: z.string(),
  operation: z.enum(["delete_pages", "rotate_pages", "append_pdf"]),
  pages: z.array(z.number().int().min(1)).max(500).optional(),
  degrees: z.number().int().optional(),
  source_path: z.string().optional(),
});

export async function readPdf(input: z.infer<typeof readPdfInput>): Promise<ToolResult> {
  const invalid = documentPath(input.path, ".pdf");
  if (invalid) return invalid;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await readDocument(input.path)));
    const count = pdf.numPages;
    const last = Math.min(input.end_page ?? count, count, input.start_page + 39);
    if (input.start_page > count || last < input.start_page) return fail("invalid_range", "page range is outside document");
    const pages: { page: number; text: string }[] = [];
    for (let n = input.start_page; n <= last; n++) {
      const page = await pdf.getPage(n);
      const items = await page.getTextContent();
      const text = items.items.map((item) => "str" in item ? item.str : "").join(" ");
      pages.push({ page: n, text });
      if (JSON.stringify(pages).length > 25_000) break;
    }
    return ok(JSON.stringify({ total_pages: count, pages }));
  } catch (error) { return codeFromErrno(error); }
}

export async function createPdf(input: z.infer<typeof createPdfInput>): Promise<ToolResult> {
  const invalid = documentPath(input.path, ".pdf");
  if (invalid) return invalid;
  // Standard PDF fonts do not support arbitrary Unicode. Fail rather than corrupt text.
  if (/[^\u0009\u000A\u000D\u0020-\u00FF]/.test(input.markdown)) {
    return fail("unsupported_glyph", "PDF generation currently supports Latin-1 text; Unicode font embedding is not yet available");
  }
  try {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const lines = input.markdown.split(/\r?\n/).flatMap((line) => {
      const plain = line.replace(/^#{1,6}\s+/, "").replace(/\*\*|__|`/g, "");
      const chunks = plain.match(/.{1,94}(?:\s|$)|.{1,94}/g);
      return chunks ?? [""];
    });
    let page = pdf.addPage([595, 842]);
    let y = 798;
    for (const line of lines) {
      if (y < 45) { page = pdf.addPage([595, 842]); y = 798; }
      page.drawText(line.trimEnd(), { x: 45, y, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
      y -= 16;
    }
    const saveError = await writeDocument(input.path, await pdf.save(), false);
    return saveError ?? ok(`created PDF ${input.path}`);
  } catch (error) { return codeFromErrno(error); }
}

export async function editPdf(input: z.infer<typeof editPdfInput>): Promise<ToolResult> {
  const invalid = documentPath(input.path, ".pdf");
  if (invalid) return invalid;
  try {
    return await withDocumentLock(input.path, async () => {
    const original = await readDocument(input.path);
    const pdf = await PDFDocument.load(original);
    const version = fingerprint(original);
    if (input.operation === "append_pdf") {
      if (!input.source_path) return fail("source_required", "source_path is required");
      const srcInvalid = documentPath(input.source_path, ".pdf");
      if (srcInvalid) return srcInvalid;
      const other = await PDFDocument.load(await readDocument(input.source_path));
      const copied = await pdf.copyPages(other, other.getPageIndices());
      for (const page of copied) pdf.addPage(page);
    } else {
      const pages = input.pages;
      if (!pages?.length) return fail("pages_required", "pages must contain page numbers");
      if (pages.some((n) => n > pdf.getPageCount())) return fail("invalid_page", "page outside PDF");
      if (input.operation === "delete_pages") {
        if (new Set(pages).size >= pdf.getPageCount()) return fail("empty_pdf", "cannot remove every page");
        for (const n of [...new Set(pages)].sort((a, b) => b - a)) pdf.removePage(n - 1);
      } else {
        if (input.degrees === undefined || input.degrees % 90 !== 0) return fail("invalid_rotation", "degrees must be divisible by 90");
        for (const n of new Set(pages)) {
          const page = pdf.getPage(n - 1);
          page.setRotation(degrees((page.getRotation().angle + input.degrees) % 360));
        }
      }
    }
    const saveError = await writeDocument(input.path, await pdf.save(), true, version);
    return saveError ?? ok(`updated PDF ${input.path}`);
    });
  } catch (error) { return codeFromErrno(error); }
}
