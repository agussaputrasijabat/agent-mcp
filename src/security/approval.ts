import { createHash, randomUUID } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { Database } from "bun:sqlite";
import { currentMcpRequest } from "../mcp/request-context.ts";
import { readSettings } from "../db/settings.ts";
import { fail, type ToolResult } from "../tools/result.ts";

const approvalTtlMs = 5 * 60_000;
const maxPending = 50;

export type ApprovalRow = {
  id: string;
  tool_name: string;
  reason: string;
  summary: string;
  auth_kind: string;
  auth_subject: string;
  created_at: string;
  expires_at: string;
  status: "pending" | "approved" | "denied";
  decided_at: string | null;
  used_at: string | null;
  preview?: string | null;
};

type ToolArguments = Record<string, unknown> & { approval_id?: string };

const pendingPreviews = new Map<string, { text: string; expires: number }>();

function filePreview(name: string, input: ToolArguments): string {
  const path = String(input.path ?? "");
  let before = "";
  try {
    if (statSync(path).size <= 1_000_000) before = readFileSync(path, "utf8");
  } catch { /* New file or unavailable content. */ }
  const after = name === "write_file"
    ? String(input.contents ?? "")
    : before.replace(String(input.old_string ?? ""), String(input.new_string ?? ""));
  const keys = (text: string) => new Map(
    text.split(/\r?\n/).flatMap((line) => {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      return match ? [[match[1]!, match[2]!]] as const : [];
    }),
  );
  const previous = keys(before);
  const next = keys(after);
  const added = [...next.keys()].filter((key) => !previous.has(key));
  const removed = [...previous.keys()].filter((key) => !next.has(key));
  const changed = [...next.keys()].filter((key) => previous.has(key) && previous.get(key) !== next.get(key));
  const describe = (label: string, names: string[]) => names.length ? `\n${label}: ${names.slice(0, 20).join(", ")}${names.length > 20 ? "…" : ""}` : "";
  const current = before.length ? `${before.length} chars` : "absent/unreadable";
  return `${name === "write_file" ? "Replace entire file" : "Replace exact text once"}: ${path}\nSize: ${current} -> ${after.length} chars` +
    describe("Keys added", added) + describe("Keys removed", removed) + describe("Keys changed", changed) +
    "\nValues and file contents are deliberately hidden. Verify the requested changes with the agent before approving.";
}

function preview(name: string, input: ToolArguments): string {
  if (name === "shell") {
    return `Shell command (operator view only, never stored in approvals):\n${String(input.command ?? "")}`;
  }
  if (name === "write_file" || name === "edit_file") return filePreview(name, input);
  return `${name}: ${String(input.key ?? input.name ?? "")}`;
}

function cleanExpiredPreviews(): void {
  const now = Date.now();
  for (const [id, value] of pendingPreviews) if (value.expires <= now) pendingPreviews.delete(id);
}

function matchesSensitiveName(path: string): boolean {
  return /(?:^|[/\\])(?:\.env(?:\.[^/\\]*)?|id_(?:rsa|ed25519|ecdsa)|authorized_keys|known_hosts|credentials(?:\.[^/\\]*)?|secrets?(?:\.[^/\\]*)?|[^/\\]+\.(?:pem|key|p12|pfx))$/i.test(path)
    || /(?:^|[/\\])\.ssh(?:[/\\]|$)/i.test(path);
}

export function sensitivePath(path: string): boolean {
  if (matchesSensitiveName(path)) return true;
  try {
    return matchesSensitiveName(realpathSync(path));
  } catch {
    try { return matchesSensitiveName(join(realpathSync(dirname(path)), basename(path))); }
    catch { return false; }
  }
}

export function approvalReason(name: string, input: ToolArguments, shellPolicy: "risky" | "strict" = "strict"): string | null {
  if (name === "memory_forget" || name === "skill_delete") return "Penghapusan data persisten";
  if (name === "write_file" || name === "edit_file") {
    return typeof input.path === "string" && sensitivePath(input.path) ? "Perubahan file sensitif" : null;
  }
  if (name !== "shell") return null;
  const command = String(input.command ?? "");
  if (shellPolicy === "strict" || process.env.AGENT_MCP_SHELL_POLICY === "strict") return "Mode shell ketat: semua perintah perlu approval";
  if (/(?:^|[\s;&|($])(?:rm|rmdir|unlink|shred|del|erase|Remove-Item|shutdown|reboot|poweroff|halt|kill|killall|pkill|sudo|mv)\b/i.test(command)) {
    return "Perintah shell berpotensi destruktif";
  }
  if ((/\bgit\b[^;\n]*\bpush\b[^;\n]*(?:\bmain\b|\bmaster\b|--force(?:-with-lease)?\b|\s-f\b)/i.test(command)) ||
      (/\bgit\b[^;\n]*\breset\b[^;\n]*--hard\b/i.test(command)) ||
      (/\bgit\b[^;\n]*\bclean\b[^;\n]*-[-a-z]*f\b/i.test(command))) {
    return "Operasi Git berisiko";
  }
  if (/\b(?:DROP\s+(?:TABLE|DATABASE)|TRUNCATE\s+(?:TABLE\s+)?\S+|DELETE\s+FROM\s+\S+\s*(?:;|$))/i.test(command)) {
    return "Perintah database destruktif";
  }
  if (/(?:^|[\s;&|])(?:>|>>)|\b(?:tee|sed\s+-i)\b/i.test(command) && /(?:\.env|[/\\]\.ssh[/\\]|(?:private|secret)[_-]?key)/i.test(command)) {
    return "Perintah shell berpotensi mengubah kredensial";
  }
  return null;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== "approval_id")
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => [key, stable(inner)]));
  }
  return value;
}

function summary(name: string, input: ToolArguments, digest: string): string {
  if (name === "shell") return `Shell command SHA-256 ${digest}; ${String(input.command ?? "").length} characters. Preview available only while this server is running.`;
  if (name === "write_file" || name === "edit_file") return filePreview(name, input).slice(0, 2000);
  return `${name} ${String(input.key ?? input.name ?? "").slice(0, 200)}`;
}

export function requireApproval(db: Database, name: string, input: ToolArguments): ToolResult | undefined {
  const reason = approvalReason(name, input, readSettings(db).shell_policy);
  if (!reason) return;
  const principal = currentMcpRequest();
  if (!principal?.authSubject) return fail("approval_unavailable", "request identity is not available");
  const now = new Date().toISOString();
  cleanExpiredPreviews();
  const digest = createHash("sha256").update(JSON.stringify({ name, arguments: stable(input) })).digest("hex");
  if (input.approval_id) {
    const result = db.query(`UPDATE approvals SET used_at = ?
      WHERE id = ? AND tool_name = ? AND arguments_hash = ? AND auth_kind = ? AND auth_subject = ?
      AND status = 'approved' AND used_at IS NULL AND expires_at > ?`)
      .run(now, input.approval_id, name, digest, principal.authKind, principal.authSubject, now);
    if (result.changes === 1) {
      pendingPreviews.delete(input.approval_id);
      return;
    }
    return fail("approval_invalid", "approval expired, already used, denied, or does not match this request");
  }

  const existing = db.query(`SELECT id FROM approvals
    WHERE tool_name = ? AND arguments_hash = ? AND auth_kind = ? AND auth_subject = ?
    AND status = 'pending' AND expires_at > ? ORDER BY created_at DESC LIMIT 1`)
    .get(name, digest, principal.authKind, principal.authSubject, now) as { id: string } | null;
  let id = existing?.id;
  if (!id) {
    const count = db.query("SELECT COUNT(*) AS count FROM approvals WHERE status = 'pending' AND expires_at > ?")
      .get(now) as { count: number };
    if (count.count >= maxPending) return fail("approval_queue_full", "too many pending approvals");
    id = randomUUID();
    db.query(`INSERT INTO approvals (id, tool_name, reason, summary, arguments_hash, auth_kind,
      auth_subject, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name, reason, summary(name, input, digest), digest, principal.authKind, principal.authSubject,
        now, new Date(Date.now() + approvalTtlMs).toISOString());
  }
  pendingPreviews.set(id, { text: preview(name, input), expires: Date.parse(new Date(Date.now() + approvalTtlMs).toISOString()) });
  return fail("approval_required",
    `Operator approval required: ${reason}. Open the Agent MCP dashboard at /approvals, approve request ${id}, then retry the SAME tool call with approval_id: "${id}". Approval expires in 5 minutes.`);
}

export function listApprovals(db: Database): ApprovalRow[] {
  cleanExpiredPreviews();
  const rows = db.query(`SELECT id, tool_name, reason, summary, auth_kind, auth_subject, created_at,
    expires_at, status, decided_at, used_at FROM approvals ORDER BY created_at DESC LIMIT 100`)
    .all() as ApprovalRow[];
  return rows.map((row) => ({
    ...row,
    preview: row.status === "pending" ? pendingPreviews.get(row.id)?.text ?? null : null,
  }));
}

export function decideApproval(db: Database, id: string, decision: "approved" | "denied"): boolean {
  cleanExpiredPreviews();
  if (decision === "approved" && !pendingPreviews.has(id)) return false;
  const now = new Date().toISOString();
  const changed = db.query(`UPDATE approvals SET status = ?, decided_at = ?
    WHERE id = ? AND status = 'pending' AND expires_at > ?`).run(decision, now, id, now).changes === 1;
  if (changed && decision === "denied") pendingPreviews.delete(id);
  return changed;
}
