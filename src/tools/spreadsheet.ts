import { lstat, readFile } from "node:fs/promises";
import { extname } from "node:path";
import ExcelJS from "exceljs";
import * as z from "zod/v4";
import { requireAbsolute, codeFromErrno } from "./paths.ts";
import { fail, ok, type ToolResult } from "./result.ts";
import { readDocument, writeDocument } from "./document-files.ts";
import { fileFingerprint, withDocumentLock } from "./document-safety.ts";

const MAX_BYTES = 20 * 1024 * 1024;
export const readSpreadsheetInput = z.object({
  path: z.string(), sheet: z.string().optional(), range: z.string().optional(),
  limit: z.number().int().min(1).max(500).default(100),
  row_offset: z.number().int().min(0).max(1_000_000).default(0),
});
export const editSpreadsheetInput = z.object({
  path: z.string(), sheet: z.string(), cells: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
});
export const createSpreadsheetInput = z.object({
  path: z.string(), sheet: z.string().default("Sheet1"),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))).max(10000),
});
export const searchSpreadsheetInput = z.object({
  path: z.string(), query: z.string().min(1).max(500), limit: z.number().int().min(1).max(300).default(50),
});

function checkPath(path: string, writing = false): ToolResult | undefined {
  const invalid = requireAbsolute(path);
  if (invalid) return invalid;
  const ext = extname(path).toLowerCase();
  if (![".xlsx", ".xlsm", ".xls"].includes(ext)) return fail("unsupported_format", "expected .xlsx, .xlsm or .xls");
  if (ext === ".xls") return fail("legacy_xls", "legacy binary .xls is not supported by ExcelJS; convert to .xlsx first");
  if (writing && ext === ".xlsm") return fail("macro_preservation", "refusing to rewrite .xlsm because the VBA macros may be lost");
  return undefined;
}

async function load(path: string): Promise<ExcelJS.Workbook> {
  const bytes = await readDocument(path);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return workbook;
}
function cellValue(cell: ExcelJS.Cell): unknown {
  const value = cell.value;
  if (value && typeof value === "object") {
    if ("formula" in value) return { formula: value.formula, result: "result" in value ? value.result : null };
    if ("richText" in value) return value.richText.map((x) => x.text).join("");
    if ("text" in value) return value.text;
    if ("hyperlink" in value && "text" in value) return value.text;
  }
  return value instanceof Date ? value.toISOString() : value;
}
async function save(workbook: ExcelJS.Workbook, path: string, overwrite: boolean, version?: string): Promise<ToolResult | undefined> {
  const bytes = await workbook.xlsx.writeBuffer();
  return writeDocument(path, new Uint8Array(bytes), overwrite, version);
}
function chooseSheet(workbook: ExcelJS.Workbook, name?: string): ExcelJS.Worksheet | undefined {
  return name ? workbook.getWorksheet(name) : workbook.worksheets[0];
}
function sheetRows(sheet: ExcelJS.Worksheet, limit: number, range?: string, offset = 0): unknown[][] {
  const rect = range ? sheet.getCell(range.includes(":") ? range.split(":")[0]! : range) : undefined;
  const startRow = Number(rect?.row ?? 1) + offset;
  const startCol = Number(rect?.col ?? 1);
  let endRow = Math.min(sheet.rowCount, startRow + limit - 1);
  let endCol = Math.min(sheet.columnCount, 80);
  if (range?.includes(":")) {
    const end = sheet.getCell(range.split(":")[1]!);
    endRow = Math.min(endRow, Number(end.row));
    endCol = Math.min(endCol, Number(end.col));
  }
  const rows: unknown[][] = [];
  for (let r = startRow; r <= endRow; r++) {
    const row: unknown[] = [];
    for (let c = startCol; c <= endCol; c++) row.push(cellValue(sheet.getRow(r).getCell(c)));
    rows.push(row);
  }
  return rows;
}

export async function readSpreadsheet(input: z.infer<typeof readSpreadsheetInput>): Promise<ToolResult> {
  const invalid = checkPath(input.path);
  if (invalid) return invalid;
  try {
    const workbook = await load(input.path);
    const sheet = chooseSheet(workbook, input.sheet);
    if (!sheet) return fail("sheet_not_found", "worksheet was not found");
    const all = sheetRows(sheet, input.limit, input.range, input.row_offset);
    const rows: unknown[][] = [];
    // Keep the tool result valid JSON instead of relying on the generic text truncator.
    const metadata = workbook.worksheets.slice(0, 30).map((s) => ({ name: s.name.slice(0, 64), rows: s.rowCount, columns: s.columnCount }));
    const startRow = (input.range ? Number(sheet.getCell(input.range.split(":")[0]!).row) : 1) + input.row_offset;
    for (const row of all) {
      const safe = row.map((cell) => {
        const serialized = JSON.stringify(cell);
        return serialized && serialized.length > 1800 ? serialized.slice(0, 1750) + "… [cell preview truncated]" : cell;
      });
      const payload = { sheets: metadata, selected: sheet.name, rows: [...rows, safe] };
      if (JSON.stringify(payload).length > 24_000) break;
      rows.push(safe);
    }
    if (!rows.length && all.length) return fail("row_too_large", "select a narrower range to preview this worksheet");
    const nextRow = startRow + rows.length;
    const more = rows.length < all.length || nextRow <= sheet.rowCount;
    return ok(JSON.stringify({
      sheets: metadata, sheet_count: workbook.worksheets.length, sheets_capped: workbook.worksheets.length > metadata.length, selected: sheet.name, rows,
      row_offset: input.row_offset, next_row_offset: more ? input.row_offset + rows.length : null,
      truncated: more,
    }));
  } catch (error) { return codeFromErrno(error); }
}

export async function createSpreadsheet(input: z.infer<typeof createSpreadsheetInput>): Promise<ToolResult> {
  const invalid = checkPath(input.path, true);
  if (invalid) return invalid;
  try {
    try { await lstat(input.path); return fail("destination_exists", "file already exists"); }
    catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(input.sheet);
    for (const row of input.rows) sheet.addRow(row);
    const saveError = await save(workbook, input.path, false);
    return saveError ?? ok(`created ${input.path}`);
  } catch (error) { return codeFromErrno(error); }
}

export async function editSpreadsheet(input: z.infer<typeof editSpreadsheetInput>): Promise<ToolResult> {
  const invalid = checkPath(input.path, true);
  if (invalid) return invalid;
  try {
    return await withDocumentLock(input.path, async () => {
    const version = await fileFingerprint(input.path);
    const workbook = await load(input.path);
    const sheet = chooseSheet(workbook, input.sheet);
    if (!sheet) return fail("sheet_not_found", "worksheet was not found");
    for (const [cell, value] of Object.entries(input.cells)) {
      if (!/^[A-Za-z]{1,3}[1-9][0-9]{0,6}$/.test(cell)) return fail("invalid_cell", `invalid Excel address: ${cell}`);
      sheet.getCell(cell).value = value;
    }
    const saveError = await save(workbook, input.path, true, version);
    return saveError ?? ok(`updated ${Object.keys(input.cells).length} cells`);
    });
  } catch (error) { return codeFromErrno(error); }
}

export async function searchSpreadsheet(input: z.infer<typeof searchSpreadsheetInput>): Promise<ToolResult> {
  const invalid = checkPath(input.path);
  if (invalid) return invalid;
  try {
    const workbook = await load(input.path);
    const matches: { sheet: string; cell: string; value: unknown }[] = [];
    let budgetCapped = false;
    for (const sheet of workbook.worksheets) {
      sheet.eachRow((row) => row.eachCell((cell) => {
        if (matches.length >= input.limit || budgetCapped) return;
        const value = cellValue(cell);
        if (JSON.stringify(value).toLowerCase().includes(input.query.toLowerCase())) {
          const serialized = JSON.stringify(value);
          const safeValue = serialized.length > 1500 ? serialized.slice(0, 1450) + "… [cell truncated]" : value;
          const match = { sheet: sheet.name, cell: cell.address, value: safeValue };
          if (JSON.stringify({ matches: [...matches, match] }).length <= 23_000) matches.push(match);
          else budgetCapped = true;
        }
      }));
      if (matches.length >= input.limit) break;
    }
    return ok(JSON.stringify({ matches, capped: budgetCapped || matches.length >= input.limit }));
  } catch (error) { return codeFromErrno(error); }
}

export async function inspectTabular(input: { path: string; limit: number }): Promise<ToolResult> {
  const invalid = requireAbsolute(input.path);
  if (invalid) return invalid;
  try {
    const extension = extname(input.path).toLowerCase();
    let rows: unknown[][];
    if (extension === ".xlsx" || extension === ".xlsm") {
      const workbook = await load(input.path);
      const sheet = workbook.worksheets[0];
      if (!sheet) return fail("empty_workbook", "workbook has no worksheets");
      rows = sheetRows(sheet, input.limit + 1);
    } else if (extension === ".json") {
      const bytes = await readFile(input.path);
      if (bytes.length > MAX_BYTES) return fail("file_too_large", "maximum file size is 20 MiB");
      const parsed: unknown = JSON.parse(bytes.toString("utf8"));
      if (!Array.isArray(parsed)) return fail("invalid_data", "JSON input must be an array of records");
      const items = parsed.slice(0, input.limit);
      const keys = [...new Set(items.flatMap((item) => typeof item === "object" && item ? Object.keys(item) : []))].slice(0, 80);
      rows = [keys, ...items.map((item) => keys.map((k) => typeof item === "object" && item ? (item as Record<string, unknown>)[k] : null))];
    } else if (extension === ".csv") {
      const info = await lstat(input.path);
      if (info.size > MAX_BYTES) return fail("file_too_large", "maximum file size is 20 MiB");
      const workbook = new ExcelJS.Workbook();
      const sheet = await workbook.csv.readFile(input.path);
      rows = sheetRows(sheet, input.limit + 1);
    } else return fail("unsupported_format", "supported: .json .csv .xlsx .xlsm");
    const header = rows[0]?.map((value) => String(value ?? "")) ?? [];
    const items = rows.slice(1, input.limit + 1);
    const columns = header.map((name, index) => {
      const values = items.map((row) => row[index]);
      const numbers = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      return {
        name: (name || `column_${index + 1}`).slice(0, 100), nulls: values.filter((v) => v === null || v === undefined || v === "").length,
        numeric_count: numbers.length,
        min: numbers.length ? Math.min(...numbers) : null,
        max: numbers.length ? Math.max(...numbers) : null,
        average: numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : null,
      };
    });
    const preview: unknown[][] = [];
    for (const item of items.slice(0, 10)) {
      const safe = item.slice(0, 80).map((cell) => {
        const serialized = JSON.stringify(cell);
        return serialized && serialized.length > 1000 ? serialized.slice(0, 950) + "… [cell truncated]" : cell;
      });
      if (JSON.stringify({ rows_sampled: items.length, columns, preview: [...preview, safe] }).length > 24_000) break;
      preview.push(safe);
    }
    return ok(JSON.stringify({ rows_sampled: items.length, columns, preview, preview_capped: preview.length < Math.min(items.length, 10) }));
  } catch (error) { return codeFromErrno(error); }
}

export const analyzeDataInput = z.object({
  path: z.string(), limit: z.number().int().min(1).max(5000).default(1000),
});
