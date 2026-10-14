import { isAbsolute } from "node:path";
import { fail, type ToolResult } from "./result.ts";

export function requireAbsolute(path: string, label = "path"): ToolResult | undefined {
  if (!isAbsolute(path)) {
    return fail("path_not_absolute", `${label} must be an absolute path`);
  }
  return undefined;
}

export function codeFromErrno(error: unknown): ToolResult {
  const code = errno(error);
  if (code === "EACCES" || code === "EPERM") {
    return fail("eacces", "the operating system denied access");
  }
  if (code === "ENOENT") {
    return fail("not_found", "path does not exist");
  }
  if (code === "EISDIR") {
    return fail("is_directory", "path is a directory");
  }
  const message = error instanceof Error ? error.message : "filesystem error";
  return fail("eio", message);
}

function errno(error: unknown): string | undefined {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
