import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { IMAGE_BASE64_CHAR_LIMIT } from "../limits.ts";
import { fail, imageResult, type ToolResult } from "./result.ts";

const mimeByExtension = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
]);

type Size = { width: number; height: number };
type Fitted = { bytes: Buffer; mime: string; size: Size | undefined };

export function imageMime(path: string): string | undefined {
  return mimeByExtension.get(extname(path).toLowerCase());
}

export function readImageFile(path: string): ToolResult {
  const mime = imageMime(path);
  if (!mime) return fail("not_image", "file is not a png, jpeg, gif, or webp image");
  const bytes = readFileSync(path);
  if (!matchesMagic(bytes, mime)) return fail("not_image", "file is not a png, jpeg, gif, or webp image");
  const size = imageSize(bytes, mime);
  const label = sizeLabel(size, bytes.length);
  if (base64CharLength(bytes.length) <= IMAGE_BASE64_CHAR_LIMIT) {
    return imageResult(`${path} ${label}`, bytes.toString("base64"), mime);
  }
  const fitted = fitImage(path, mime, size ?? sipsSize(path));
  if ("content" in fitted) return fitted;
  const preview = sizeLabel(fitted.size, fitted.bytes.length);
  const mimeNote = fitted.mime === mime ? "" : ` ${fitted.mime}`;
  return imageResult(`${path} ${label}, preview ${preview}${mimeNote}`, fitted.bytes.toString("base64"), fitted.mime);
}

function base64CharLength(byteLength: number): number {
  return 4 * Math.ceil(byteLength / 3);
}

function sizeLabel(size: Size | undefined, byteLength: number): string {
  if (size && size.width > 0 && size.height > 0) return `${size.width}×${size.height}`;
  return `${byteLength} bytes`;
}

function matchesMagic(bytes: Buffer, mime: string): boolean {
  if (mime === "image/png") return bytes.length >= 8 && bytes[0] === 0x89 && bytes.toString("ascii", 1, 4) === "PNG";
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mime === "image/gif") {
    const header = bytes.toString("ascii", 0, 6);
    return header === "GIF87a" || header === "GIF89a";
  }
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

function imageSize(bytes: Buffer, mime: string): Size | undefined {
  if (mime === "image/png") return pngSize(bytes);
  if (mime === "image/jpeg") return jpegSize(bytes);
  if (mime === "image/gif") return gifSize(bytes);
  return webpSize(bytes);
}

function pngSize(bytes: Buffer): Size | undefined {
  if (bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") return undefined;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function gifSize(bytes: Buffer): Size | undefined {
  if (bytes.length < 10) return undefined;
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

function jpegSize(bytes: Buffer): Size | undefined {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return undefined;
    const marker = bytes[offset]!;
    offset += 1;
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
    if (offset + 1 >= bytes.length) return undefined;
    const length = bytes.readUInt16BE(offset);
    if (length < 2) return undefined;
    const startOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (startOfFrame && offset + 6 < bytes.length) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return undefined;
}

function webpSize(bytes: Buffer): Size | undefined {
  if (bytes.length < 16) return undefined;
  const chunk = bytes.toString("ascii", 12, 16);
  if (chunk === "VP8X" && bytes.length >= 30) {
    return {
      width: 1 + (bytes[24]! | (bytes[25]! << 8) | (bytes[26]! << 16)),
      height: 1 + (bytes[27]! | (bytes[28]! << 8) | (bytes[29]! << 16)),
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === "VP8 ") {
    const marker = bytes.indexOf(Buffer.from([0x9d, 0x01, 0x2a]));
    if (marker >= 0 && marker + 7 <= bytes.length) {
      return {
        width: bytes.readUInt16LE(marker + 3) & 0x3fff,
        height: bytes.readUInt16LE(marker + 5) & 0x3fff,
      };
    }
  }
  return undefined;
}

type Step = { edge: number | null; format: "png" | "jpeg" | "gif"; quality?: number };

function fitImage(path: string, mime: string, size: Size | undefined): Fitted | ToolResult {
  const directory = mkdtempSync(join(tmpdir(), "agent-mcp-image-"));
  let produced = false;
  let lastError = "sips failed";
  try {
    let index = 0;
    for (const step of previewSteps(mime, size)) {
      const dest = join(directory, `preview-${index}.${step.format === "jpeg" ? "jpg" : step.format}`);
      index += 1;
      const args = ["-s", "format", step.format];
      if (step.format === "jpeg" && step.quality !== undefined) args.push("-s", "formatOptions", String(step.quality));
      if (step.edge !== null) args.push("-Z", String(step.edge));
      args.push(path, "--out", dest);
      const run = runSips(args);
      if (!run.ok) {
        lastError = run.message;
        continue;
      }
      const fitted = readFileSync(dest);
      if (fitted.length === 0) {
        lastError = "sips wrote an empty file";
        continue;
      }
      produced = true;
      const outMime = step.format === "jpeg" ? "image/jpeg" : step.format === "gif" ? "image/gif" : "image/png";
      if (base64CharLength(fitted.length) > IMAGE_BASE64_CHAR_LIMIT) continue;
      return { bytes: fitted, mime: outMime, size: imageSize(fitted, outMime) ?? sipsSize(dest) };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "sips failed";
    return fail("image_resize_failed", `could not resize the image: ${message.slice(0, 180)}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  if (!produced) return fail("image_resize_failed", `could not resize the image: ${lastError}`);
  return fail("image_too_large", `image exceeds ${IMAGE_BASE64_CHAR_LIMIT} base64 characters after resize`);
}

function previewSteps(mime: string, size: Size | undefined): Step[] {
  const keep = mime === "image/png" ? "png" : mime === "image/jpeg" ? "jpeg" : mime === "image/gif" ? "gif" : undefined;
  const longEdge = size ? Math.max(size.width, size.height) : undefined;
  const steps: Step[] = [];
  if (keep) steps.push({ edge: longEdge !== undefined && longEdge <= 1600 ? null : 1600, format: keep });
  for (const item of [
    { edge: 1600, quality: 80 },
    { edge: 1280, quality: 70 },
    { edge: 1024, quality: 60 },
    { edge: 800, quality: 50 },
    { edge: 640, quality: 40 },
  ]) {
    const edge = longEdge !== undefined && longEdge <= item.edge ? null : item.edge;
    steps.push({ edge, format: "jpeg", quality: item.quality });
  }
  return steps;
}

function sipsSize(path: string): Size | undefined {
  const run = runSips(["-g", "pixelWidth", "-g", "pixelHeight", path]);
  if (!run.ok) return undefined;
  const width = /pixelWidth: (\d+)/.exec(run.stdout)?.[1];
  const height = /pixelHeight: (\d+)/.exec(run.stdout)?.[1];
  if (!width || !height) return undefined;
  const parsed = { width: Number(width), height: Number(height) };
  if (parsed.width <= 0 || parsed.height <= 0) return undefined;
  return parsed;
}

function runSips(args: string[]): { ok: true; stdout: string } | { ok: false; message: string } {
  try {
    const result = Bun.spawnSync(["sips", ...args], { stdout: "pipe", stderr: "pipe" });
    if (result.exitCode === 0) return { ok: true, stdout: result.stdout.toString("utf8") };
    const line = result.stderr.toString("utf8").trim().split("\n")[0] ?? "sips failed";
    return { ok: false, message: line.slice(0, 180) || "sips failed" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "sips failed";
    if (message.includes("ENOENT")) return { ok: false, message: "sips is not available" };
    return { ok: false, message: message.slice(0, 180) };
  }
}
