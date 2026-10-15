import { extname } from "node:path";
import { lstatSync } from "node:fs";
import * as z from "zod/v4";
import { readFile } from "./files.ts";
import { readPdf } from "./pdf.ts";
import { readDocx } from "./docx.ts";
import { readSpreadsheet } from "./spreadsheet.ts";
import { requireAbsolute } from "./paths.ts";
import type { ToolResult } from "./result.ts";

export const previewFileInput = z.object({ path: z.string() });
export async function previewFile(input: z.infer<typeof previewFileInput>): Promise<ToolResult> {
  const invalid = requireAbsolute(input.path);
  if (invalid) return invalid;
  switch (extname(input.path).toLowerCase()) {
    case ".pdf": return readPdf({ path: input.path, start_page: 1 });
    case ".docx": return readDocx({ path: input.path, limit: 100 });
    case ".xlsx":
    case ".xlsm": return readSpreadsheet({ path: input.path, limit: 75, row_offset: 0 });
    case ".md":
    case ".markdown": {
      // Never expose an editable hash when the preview text could be truncated.
      try {
        const info = lstatSync(input.path);
        if (!info.isFile() || info.isSymbolicLink()) return readFile({ path: input.path });
        if (info.size > 20_000) return readFile({ path: input.path });
      } catch { return readFile({ path: input.path }); }
      const result = readFile({ path: input.path, include_hash: true });
      if (result.content[0].text.includes("[truncated]")) return readFile({ path: input.path });
      return result;
    }
    default: return readFile({ path: input.path });
  }
}
