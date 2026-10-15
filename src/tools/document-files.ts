import { randomUUID } from "node:crypto";
import { link, lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { codeFromErrno, requireAbsolute } from "./paths.ts";
import { fail, type ToolResult } from "./result.ts";
import { assertSafeOfficeZip, fileFingerprint } from "./document-safety.ts";

export function documentPath(path: string, extension: string): ToolResult | undefined {
  const invalid = requireAbsolute(path);
  if (invalid) return invalid;
  if (extname(path).toLowerCase() !== extension) return fail("unsupported_format", `path must end in ${extension}`);
  return undefined;
}
export async function readDocument(path: string): Promise<Buffer> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("document must be a regular file (not a symlink)");
  if (info.size > 20 * 1024 * 1024) throw new Error("document exceeds 20 MiB limit");
  const bytes = await readFile(path);
  if ([".docx", ".xlsx", ".xlsm"].includes(extname(path).toLowerCase())) assertSafeOfficeZip(bytes);
  return bytes;
}
export async function writeDocument(path: string, bytes: Uint8Array, overwrite: boolean, expectedHash?: string): Promise<ToolResult | undefined> {
  if (bytes.byteLength > 20 * 1024 * 1024) return fail("document_too_large", "output document exceeds 20 MiB limit");
  if (!overwrite) {
    try {
      await lstat(path);
      return fail("destination_exists", "destination already exists");
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) return codeFromErrno(error);
    }
  } else {
    try {
      const current = await lstat(path);
      if (current.isSymbolicLink() || !current.isFile()) return fail("invalid_destination", "destination must be a regular file");
    } catch (error) { return codeFromErrno(error); }
  }
  const temp = `${path}.agent-mcp-${randomUUID()}.tmp`;
  try {
    await writeFile(temp, bytes, { flag: "wx", mode: 0o600 });
    if (overwrite) {
      if (!expectedHash || await fileFingerprint(path) !== expectedHash) return fail("file_changed", "document changed before saving");
      await rename(temp, path);
    } else {
      await link(temp, path);
    }
    return undefined;
  } finally {
    await unlink(temp).catch((error: unknown) => {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    });
  }
}
