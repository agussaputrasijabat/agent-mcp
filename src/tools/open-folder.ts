import { spawn } from "node:child_process";
import { lstat } from "node:fs/promises";
import { dirname } from "node:path";
import * as z from "zod/v4";
import { requireAbsolute, codeFromErrno } from "./paths.ts";
import { fail, ok, type ToolResult } from "./result.ts";

export const openInFolderInput = z.object({ path: z.string() });

export async function openInFolder(input: z.infer<typeof openInFolderInput>): Promise<ToolResult> {
  const invalid = requireAbsolute(input.path);
  if (invalid) return invalid;
  try {
    const info = await lstat(input.path);
    const dir = info.isDirectory() ? input.path : dirname(input.path);
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer.exe" : "xdg-open";
    const args = process.platform === "darwin" && !info.isDirectory()
      ? ["-R", input.path]
      : process.platform === "win32" && !info.isDirectory()
      ? [`/select,${input.path}`]
      : [dir];
    return await new Promise<ToolResult>((resolve) => {
      const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
      let settled = false;
      const finish = (result: ToolResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      child.once("error", (error) => finish(fail("launcher_failed", error.message)));
      child.once("close", (code) => {
        finish(code === 0 ? ok(`opened folder ${dir}`) : fail("launcher_failed", `file manager exited with status ${code}`));
      });
      child.once("spawn", () => child.unref());
      const timer = setTimeout(() => finish(ok(`requested desktop file manager to open ${dir}`)), 1000);
    });
  } catch (error) { return codeFromErrno(error); }
}
