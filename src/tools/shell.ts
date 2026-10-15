import { statSync } from "node:fs";
import * as z from "zod/v4";
import {
  COMMAND_CHAR_LIMIT,
  OUTPUT_CHAR_LIMIT,
  SHELL_CONCURRENCY,
  SHELL_TIMEOUT_MAX_MS,
  SHELL_TIMEOUT_MIN_MS,
  SHELL_TIMEOUT_MS,
} from "../limits.ts";
import { requireAbsolute } from "./paths.ts";
import { fail, ok, type ToolResult } from "./result.ts";

async function readBounded(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let content = "";
  let truncated = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const text = decoder.decode(next.value, { stream: true });
      const remaining = OUTPUT_CHAR_LIMIT - content.length;
      if (text.length > remaining) truncated = true;
      if (remaining > 0) content += text.slice(0, remaining);
    }
    const final = decoder.decode();
    const remaining = OUTPUT_CHAR_LIMIT - content.length;
    if (final.length > remaining) truncated = true;
    if (remaining > 0) content += final.slice(0, remaining);
    return truncated ? `${content}\n[truncated]` : content;
  } finally {
    reader.releaseLock();
  }
}

export const shellInput = z.object({
  command: z.string(),
  cwd: z.string().optional(),
  timeout_ms: z.number().int().optional(),
  approval_id: z.string().uuid().optional(),
});

export class ShellGate {
  private running = 0;

  constructor(private readonly limitSource: number | (() => number) = SHELL_CONCURRENCY) {}

  currentLimit(): number {
    return typeof this.limitSource === "function" ? this.limitSource() : this.limitSource;
  }

  tryAcquire(): boolean {
    if (this.running >= this.currentLimit()) return false;
    this.running += 1;
    return true;
  }

  release(): void {
    this.running = Math.max(0, this.running - 1);
  }
}

export async function runShell(
  input: z.infer<typeof shellInput>,
  gate: ShellGate,
  defaults: { timeoutMs: number; timeoutMaxMs: number } = {
    timeoutMs: SHELL_TIMEOUT_MS,
    timeoutMaxMs: SHELL_TIMEOUT_MAX_MS,
  },
): Promise<ToolResult> {
  if (input.command.length === 0) return fail("command_required", "command is empty");
  if (input.command.length > COMMAND_CHAR_LIMIT) {
    return fail("validation_error", `command exceeds ${COMMAND_CHAR_LIMIT} characters`);
  }
  const timeoutMs = input.timeout_ms ?? defaults.timeoutMs;
  if (timeoutMs < SHELL_TIMEOUT_MIN_MS || timeoutMs > defaults.timeoutMaxMs) {
    return fail("invalid_timeout", `timeout_ms must be from ${SHELL_TIMEOUT_MIN_MS} to ${defaults.timeoutMaxMs}`);
  }
  const cwd = input.cwd ?? process.cwd();
  if (input.cwd) {
    const absolute = requireAbsolute(input.cwd, "cwd");
    if (absolute) return absolute;
  }
  try {
    if (!statSync(cwd).isDirectory()) return fail("cwd_not_found", "cwd is not a directory");
  } catch {
    return fail("cwd_not_found", "cwd does not exist");
  }

  if (!gate.tryAcquire()) {
    return fail("shell_busy", `too many commands are running, limit is ${gate.currentLimit()}`);
  }

  try {
    const proc = Bun.spawn(["bash", "-lc", input.command], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
      detached: process.platform !== "win32",
    });
    let timedOut = false;
    let completed = false;
    let forceTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (signal: NodeJS.Signals) => {
      if (process.platform !== "win32" && proc.pid) {
        try { process.kill(-proc.pid, signal); return; } catch { /* process group exited */ }
      }
      try { proc.kill(signal); } catch { /* process exited */ }
    };
    const timer = setTimeout(() => {
      if (completed) return;
      timedOut = true;
      stop("SIGTERM");
      forceTimer = setTimeout(() => { if (!completed) stop("SIGKILL"); }, 750);
    }, timeoutMs);
    const stdoutPromise = readBounded(proc.stdout);
    const stderrPromise = readBounded(proc.stderr);
    try {
      const exitCode = await proc.exited;
      const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
      if (timedOut) return fail("shell_timeout", `command exceeded ${timeoutMs}ms`);
      return ok(`exit code ${exitCode}\n${stdout}${stderr ? `stderr:\n${stderr}` : ""}`);
    } finally {
      completed = true;
      clearTimeout(timer);
      if (forceTimer) clearTimeout(forceTimer);
      if (timedOut) stop("SIGKILL");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "failed to start bash";
    console.error(JSON.stringify({ level: "error", msg: "shell_spawn_failed", message }));
    return fail("eio", message);
  } finally {
    gate.release();
  }
}
