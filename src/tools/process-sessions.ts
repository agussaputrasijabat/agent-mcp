import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import * as z from "zod/v4";
import { currentMcpRequest } from "../mcp/request-context.ts";
import { OUTPUT_CHAR_LIMIT } from "../limits.ts";
import { fail, ok, type ToolResult } from "./result.ts";
import { requireAbsolute } from "./paths.ts";

const MAX_SESSIONS = 16;
const MAX_BUFFER = 1_000_000;
const MAX_RUNTIME = 3_600_000;
const RETAIN_MS = 15 * 60_000;
const MAX_INPUT = 64_000;
type Session = {
  id: string;
  owner: string;
  child: ChildProcessWithoutNullStreams;
  status: "running" | "finished" | "timeout" | "terminated" | "failed";
  exitCode: number | null;
  output: string;
  base: number;
  startedAt: number;
  endedAt?: number;
  timer: ReturnType<typeof setTimeout>;
  forceTimer?: ReturnType<typeof setTimeout>;
};

export const startProcessInput = z.object({
  command: z.string().min(1).max(10_000),
  cwd: z.string().optional(),
  timeout_ms: z.number().int().min(1000).max(MAX_RUNTIME).default(600_000),
});
export const readProcessOutputInput = z.object({
  session_id: z.string().uuid(),
  offset: z.number().int().min(0).default(0),
  length: z.number().int().min(1).max(OUTPUT_CHAR_LIMIT - 1000).default(8000),
});
export const writeProcessInputInput = z.object({ session_id: z.string().uuid(), input: z.string().max(MAX_INPUT), end: z.boolean().default(false) });
export const terminateProcessInput = z.object({ session_id: z.string().uuid() });
export const listProcessesInput = z.object({});

function owner(): string {
  const req = currentMcpRequest();
  return req ? `${req.authKind}:${req.authSubject}` : "local-test";
}
function stopProcess(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && child.pid) {
    try { process.kill(-child.pid, signal); return; } catch { /* group may have exited */ }
  }
  try { child.kill(signal); } catch { /* already exited */ }
}

export class ProcessSessions {
  private readonly sessions = new Map<string, Session>();

  private prune(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (session.endedAt && now - session.endedAt > RETAIN_MS) this.sessions.delete(id);
    }
  }

  private get(id: string): Session | ToolResult {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner()) return fail("session_not_found", "session is missing or inaccessible");
    return session;
  }

  async start(input: z.infer<typeof startProcessInput>): Promise<ToolResult> {
    this.prune();
    if (input.cwd) {
      const invalid = requireAbsolute(input.cwd, "cwd");
      if (invalid) return invalid;
      try {
        if (!(await stat(input.cwd)).isDirectory()) return fail("cwd_not_found", "cwd must be a directory");
      } catch { return fail("cwd_not_found", "cwd does not exist"); }
    }
    const active = [...this.sessions.values()].filter((s) => !s.endedAt).length;
    if (active >= MAX_SESSIONS) return fail("session_limit", "too many active processes");
    const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : (process.env.SHELL || "/bin/sh");
    const args = process.platform === "win32" ? ["/d", "/s", "/c", input.command] : ["-lc", input.command];
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command, args, {
        cwd: input.cwd ?? process.cwd(),
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (error) { return fail("spawn_failed", error instanceof Error ? error.message : "failed to spawn"); }
    const id = randomUUID();
    const session: Session = {
      id, owner: owner(), child, status: "running", exitCode: null, output: "", base: 0, startedAt: Date.now(),
      timer: setTimeout(() => {
        if (session.status !== "running") return;
        session.status = "timeout";
        stopProcess(child, "SIGTERM");
        session.forceTimer = setTimeout(() => stopProcess(child, "SIGKILL"), 1000);
        session.forceTimer.unref();
      }, input.timeout_ms),
    };
    session.timer.unref();
    this.sessions.set(id, session);
    const append = (prefix: string, value: string): void => {
      session.output += prefix + value;
      if (session.output.length > MAX_BUFFER) {
        const excess = session.output.length - MAX_BUFFER;
        session.output = session.output.slice(excess);
        session.base += excess;
      }
    };
    const stdout = new StringDecoder("utf8");
    const stderr = new StringDecoder("utf8");
    child.stdout.on("data", (chunk: Buffer) => append("", stdout.write(chunk)));
    child.stderr.on("data", (chunk: Buffer) => append("[stderr] ", stderr.write(chunk)));
    child.stdout.on("end", () => append("", stdout.end()));
    child.stderr.on("end", () => append("[stderr] ", stderr.end()));
    child.stdin.on("error", (error) => append("[stdin error] ", error.message));
    child.on("error", (error) => {
      append("[error] ", error.message);
      session.status = "failed";
      session.endedAt = Date.now();
      clearTimeout(session.timer);
    });
    child.on("close", (code) => {
      session.exitCode = code;
      if (session.status === "running") session.status = "finished";
      session.endedAt = Date.now();
      clearTimeout(session.timer);
      if (session.forceTimer) clearTimeout(session.forceTimer);
    });
    return ok(JSON.stringify({ session_id: id, pid: child.pid ?? null, status: session.status }));
  }

  read(input: z.infer<typeof readProcessOutputInput>): ToolResult {
    this.prune();
    const session = this.get(input.session_id);
    if ("content" in session) return session;
    if (input.offset < session.base) return fail("output_evicted", `oldest available offset is ${session.base}`);
    const end = session.base + session.output.length;
    let output = session.output.slice(input.offset - session.base, input.offset - session.base + input.length);
    // JSON escaping can double output length; preserve a valid JSON response rather than truncating it.
    while (JSON.stringify(output).length > OUTPUT_CHAR_LIMIT - 750) {
      output = output.slice(0, Math.max(1, Math.floor(output.length * 0.75)));
    }
    return ok(JSON.stringify({
      session_id: session.id, status: session.status, exit_code: session.exitCode,
      output, next_offset: Math.max(input.offset, Math.min(end, input.offset + output.length)),
      available_start: session.base, available_end: end, has_more: input.offset + output.length < end,
    }));
  }

  write(input: z.infer<typeof writeProcessInputInput>): ToolResult {
    const session = this.get(input.session_id);
    if ("content" in session) return session;
    if (session.status !== "running" || session.child.stdin.destroyed) return fail("session_closed", "process is no longer accepting input");
    try {
      session.child.stdin.write(input.input);
      if (input.end) session.child.stdin.end();
      return ok("input sent");
    } catch (error) { return fail("write_failed", error instanceof Error ? error.message : "stdin write failed"); }
  }

  terminate(input: z.infer<typeof terminateProcessInput>): ToolResult {
    const session = this.get(input.session_id);
    if ("content" in session) return session;
    if (session.endedAt) return ok("process already stopped");
    session.status = "terminated";
    stopProcess(session.child, "SIGTERM");
    session.forceTimer = setTimeout(() => stopProcess(session.child, "SIGKILL"), 1000);
    session.forceTimer.unref();
    return ok("termination requested");
  }

  list(): ToolResult {
    this.prune();
    return ok(JSON.stringify([...this.sessions.values()]
      .filter((s) => s.owner === owner())
      .map((s) => ({
        session_id: s.id, pid: s.child.pid ?? null, status: s.status, exit_code: s.exitCode,
        started_at: new Date(s.startedAt).toISOString(), output_start: s.base,
        output_end: s.base + s.output.length,
      }))));
  }
}
