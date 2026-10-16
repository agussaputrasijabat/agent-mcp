import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rmdir } from "node:fs/promises";
import { fail, type ToolResult } from "./result.ts";
import { codeFromErrno } from "./paths.ts";

const MAX_ZIP_ENTRIES = 2000;
const MAX_ZIP_TOTAL = 64 * 1024 * 1024;
const MAX_ZIP_ENTRY = 32 * 1024 * 1024;
const MAX_RATIO = 200;

export function assertSafeOfficeZip(bytes: Uint8Array): void {
  const zip = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // ZIP EOCD can be followed by a comment (maximum 65535 bytes).
  const start = Math.max(0, zip.length - 65_557);
  let eocd = -1;
  for (let i = zip.length - 22; i >= start; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50 && i + 22 + zip.readUInt16LE(i + 20) === zip.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("invalid_zip: end of central directory missing");
  if (zip.readUInt16LE(eocd + 4) !== 0 || zip.readUInt16LE(eocd + 6) !== 0) {
    throw new Error("unsupported_zip: multi-disk archives are not supported");
  }
  const count = zip.readUInt16LE(eocd + 10);
  const centralSize = zip.readUInt32LE(eocd + 12);
  const centralOffset = zip.readUInt32LE(eocd + 16);
  if (count > MAX_ZIP_ENTRIES || count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error("zip_limit: too many entries or ZIP64 not supported");
  }
  if (centralOffset + centralSize > eocd) throw new Error("invalid_zip: central directory out of bounds");
  let pos = centralOffset;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (pos + 46 > eocd || zip.readUInt32LE(pos) !== 0x02014b50) throw new Error("invalid_zip: bad central entry");
    const flags = zip.readUInt16LE(pos + 8);
    const method = zip.readUInt16LE(pos + 10);
    const compressed = zip.readUInt32LE(pos + 20);
    const expanded = zip.readUInt32LE(pos + 24);
    const nameLength = zip.readUInt16LE(pos + 28);
    const extraLength = zip.readUInt16LE(pos + 30);
    const commentLength = zip.readUInt16LE(pos + 32);
    const localOffset = zip.readUInt32LE(pos + 42);
    if (compressed === 0xffffffff || expanded === 0xffffffff || localOffset === 0xffffffff ||
        (flags & 1) !== 0 || ![0, 8].includes(method)) {
      throw new Error("unsupported_zip: encrypted, ZIP64 or unsupported compression");
    }
    total += expanded;
    if (expanded > MAX_ZIP_ENTRY || total > MAX_ZIP_TOTAL ||
        (expanded > 0 && (compressed === 0 || expanded / compressed > MAX_RATIO))) {
      throw new Error("zip_limit: expanded content exceeds safety limits");
    }
    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("invalid_zip: local entry out of bounds");
    }
    pos += 46 + nameLength + extraLength + commentLength;
    if (pos > eocd) throw new Error("invalid_zip: truncated central directory");
  }
  if (pos !== centralOffset + centralSize) throw new Error("invalid_zip: inconsistent central directory");
}

export function fingerprint(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function fileFingerprint(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("file_changed: file is no longer regular");
  if (info.size > 20 * 1024 * 1024) throw new Error("file_changed: document exceeds limit");
  return fingerprint(await readFile(path));
}

export async function withDocumentLock<T extends ToolResult>(
  path: string,
  action: () => Promise<T>,
): Promise<T | ToolResult> {
  const lock = `${path}.agent-mcp.lock`;
  try {
    await mkdir(lock, { mode: 0o700 });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      return fail("file_busy", "another agent is editing this file");
    }
    return codeFromErrno(error);
  }
  try {
    return await action();
  } finally {
    await rmdir(lock);
  }
}
