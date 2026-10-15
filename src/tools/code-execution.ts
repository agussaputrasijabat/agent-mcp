import { spawn } from "node:child_process";
import * as z from "zod/v4";
import { requireAbsolute } from "./paths.ts";
import { fail, ok, type ToolResult } from "./result.ts";
import { OUTPUT_CHAR_LIMIT } from "../limits.ts";

export const executeCodeInput = z.object({
  language: z.enum(["python", "javascript", "r"]),
  code: z.string().min(1).max(100_000),
  cwd: z.string().optional(),
  timeout_ms: z.number().int().min(1000).max(120_000).default(30_000),
});
export async function executeCode(input: z.infer<typeof executeCodeInput>): Promise<ToolResult> {
  if (input.cwd) {
    const invalid = requireAbsolute(input.cwd, "cwd");
    if (invalid) return invalid;
  }
  const executable = input.language === "python" ? "python3" : input.language === "r" ? "Rscript" : "node";
  const args = input.language === "javascript" ? ["--input-type=module", "-e", input.code] : input.language === "python" ? ["-c", input.code] : ["-e", input.code];
  return new Promise<ToolResult>((resolve) => {
    let output = "";
    let settled = false;
    let timedOut = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const child = spawn(executable, args, {
      cwd: input.cwd ?? process.cwd(), stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32", windowsHide: true,
    });
    const done = (result: ToolResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      resolve(result);
    };
    const kill = (signal: NodeJS.Signals) => {
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, signal); return; } catch { /* already stopped */ }
      }
      try { child.kill(signal); } catch { /* already stopped */ }
    };
    const append = (chunk: Buffer) => {
      if (output.length < OUTPUT_CHAR_LIMIT - 300) output += chunk.toString("utf8").slice(0, OUTPUT_CHAR_LIMIT - 300 - output.length);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (error) => done(fail("runtime_unavailable", error.message)));
    child.on("close", (exitCode) => done(timedOut
      ? fail("execution_timeout", `execution exceeded ${input.timeout_ms}ms`)
      : exitCode === 0 ? ok(`exit code 0\n${output}`)
      : fail("execution_failed", `exit code ${exitCode}\n${output}`)));
    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      forceTimer = setTimeout(() => kill("SIGKILL"), 1000);
      forceTimer.unref();
    }, input.timeout_ms);
    timer.unref();
  });
}
