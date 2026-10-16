import { copyFile, lstat, mkdir, readdir, readlink, rm, stat, symlink, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import { withDocumentLock } from "./document-safety.ts";
import { join, resolve, sep } from "node:path";
import * as z from "zod/v4";
import { codeFromErrno, requireAbsolute } from "./paths.ts";
import { fail, ok, type ToolResult } from "./result.ts";

export const listDirectoryInput = z.object({
  path: z.string(),
  depth: z.number().int().min(1).max(8).default(1),
  offset: z.number().int().min(0).max(20_000).default(0),
  limit: z.number().int().min(1).max(500).default(100),
});
export const createDirectoryInput = z.object({ path: z.string(), recursive: z.boolean().default(true) });
export const movePathInput = z.object({ source: z.string(), destination: z.string() });
export const statPathInput = z.object({ path: z.string() });

export async function listDirectory(input: z.infer<typeof listDirectoryInput>): Promise<ToolResult> {
  const invalid = requireAbsolute(input.path);
  if (invalid) return invalid;
  try {
    if (!(await stat(input.path)).isDirectory()) return fail("not_directory", "path is not a directory");
    const collected: { path: string; type: string }[] = [];
    const maxEntries = input.offset + input.limit + 1;
    const visit = async (dir: string, depth: number): Promise<void> => {
      if (collected.length >= maxEntries) return;
      const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (collected.length >= maxEntries) return;
        const path = join(dir, entry.name);
        const type = entry.isSymbolicLink() ? "symlink" : entry.isDirectory() ? "directory" : entry.isFile() ? "file" : "other";
        collected.push({ path, type });
        if (type === "directory" && depth < input.depth) await visit(path, depth + 1);
      }
    };
    await visit(input.path, 1);
    return ok(JSON.stringify({
      entries: collected.slice(input.offset, input.offset + input.limit),
      next_offset: collected.length > input.offset + input.limit ? input.offset + input.limit : null,
    }));
  } catch (error) { return codeFromErrno(error); }
}

export async function createDirectory(input: z.infer<typeof createDirectoryInput>): Promise<ToolResult> {
  const invalid = requireAbsolute(input.path);
  if (invalid) return invalid;
  try {
    await mkdir(input.path, { recursive: input.recursive });
    return ok(`created ${input.path}`);
  } catch (error) { return codeFromErrno(error); }
}

async function copyTreeContents(source: string, destination: string): Promise<void> {
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) {
      await mkdir(to);
      await copyTreeContents(from, to);
    } else if (entry.isFile()) {
      await copyFile(from, to, constants.COPYFILE_EXCL);
    } else if (entry.isSymbolicLink()) {
      await symlink(await readlink(from), to);
    } else {
      throw new Error("unsupported file type in directory");
    }
  }
}

export async function movePath(input: z.infer<typeof movePathInput>): Promise<ToolResult> {
  const invalid = requireAbsolute(input.source, "source") ?? requireAbsolute(input.destination, "destination");
  if (invalid) return invalid;
  const source = resolve(input.source);
  const destination = resolve(input.destination);
  if (source === destination) return fail("same_path", "source and destination are identical");
  try {
    const src = await lstat(source);
    if (src.isSymbolicLink()) return fail("symlink_not_allowed", "refusing to move a symbolic link");
    if (src.isDirectory() && destination.startsWith(source + sep)) return fail("invalid_destination", "cannot move directory inside itself");
    return await withDocumentLock(source, async () => {
      try { await lstat(destination); return fail("destination_exists", "destination already exists"); }
      catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
      // Exclusive creation on the destination prevents the POSIX rename() overwrite race.
      if (src.isFile()) {
        const before = await stat(source);
        await copyFile(source, destination, constants.COPYFILE_EXCL);
        const after = await stat(source);
        if (after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
          return fail("file_changed", "source changed during move; both copies were preserved");
        }
        await unlink(source);
      } else if (src.isDirectory()) {
        await mkdir(destination);
        // A directory move is copy-then-remove, not atomic; no destination is replaced.
        try {
          await copyTreeContents(source, destination);
        } catch (error) {
          return fail("move_incomplete", `directory copy failed; source preserved and partial destination is at ${destination}`);
        }
        await rm(source, { recursive: true });
      } else {
        return fail("unsupported_type", "only regular files and directories can be moved");
      }
      return ok(`moved ${source} -> ${destination}`);
    });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EXDEV") {
      return fail("cross_device", "cross-filesystem moves are not supported; copy and delete explicitly");
    }
    return codeFromErrno(error);
  }
}

export async function statPath(input: z.infer<typeof statPathInput>): Promise<ToolResult> {
  const invalid = requireAbsolute(input.path);
  if (invalid) return invalid;
  try {
    const info = await lstat(input.path);
    return ok(JSON.stringify({
      path: input.path,
      type: info.isSymbolicLink() ? "symlink" : info.isDirectory() ? "directory" : info.isFile() ? "file" : "other",
      size: info.size,
      mode: info.mode & 0o777,
      created_at: info.birthtime.toISOString(),
      modified_at: info.mtime.toISOString(),
      accessed_at: info.atime.toISOString(),
    }));
  } catch (error) { return codeFromErrno(error); }
}
