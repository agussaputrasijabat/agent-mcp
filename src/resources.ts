import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const sourceRoot = join(import.meta.dir, "..");
let bundled: Record<string, string> | undefined;
const decoded = new Map<string, Uint8Array>();

export function registerBundledResources(resources: Record<string, string>): void {
  bundled = resources;
}

export function resourcesBundled(): boolean {
  return bundled !== undefined;
}

export function resourceNames(prefix: string): string[] {
  if (bundled) return Object.keys(bundled).filter((name) => name.startsWith(prefix)).sort();
  const dir = join(sourceRoot, prefix);
  return existsSync(dir) ? readdirSync(dir).map((name) => prefix + name).sort() : [];
}

export function resourceBytes(name: string): Uint8Array | undefined {
  if (name.includes("..") || name.startsWith("/") || name.includes("\\")) return undefined;
  if (bundled) {
    const encoded = bundled[name];
    if (encoded === undefined) return undefined;
    let bytes = decoded.get(name);
    if (!bytes) {
      bytes = Buffer.from(encoded, "base64");
      decoded.set(name, bytes);
    }
    return bytes;
  }
  const path = join(sourceRoot, name);
  return existsSync(path) ? readFileSync(path) : undefined;
}

export function resourceText(name: string): string {
  const bytes = resourceBytes(name);
  if (!bytes) throw new Error(`missing_resource:${name}`);
  return Buffer.from(bytes).toString("utf8");
}

export function resourceResponse(name: string, contentType: string): Response {
  const bytes = resourceBytes(name);
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(bytes.slice().buffer, { headers: { "content-type": contentType } });
}
