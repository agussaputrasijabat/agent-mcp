import type { Database } from "bun:sqlite";

const MAX_PER_CLIENT = 1;
const MAX_GLOBAL = 2;
export const SANDBOX_LEASE_MS = 60 * 60_000;

export function sandboxOwned(db: Database, owner: string, name: string): boolean {
  const row = db.query("SELECT auth_subject FROM computer_sandbox_owners WHERE name = ?").get(name) as { auth_subject: string } | null;
  return row?.auth_subject === owner;
}

export function listOwnedSandboxes(db: Database, owner: string): string[] {
  return (db.query("SELECT name FROM computer_sandbox_owners WHERE auth_subject = ? ORDER BY name")
    .all(owner) as { name: string }[]).map((row) => row.name);
}

export function expiredSandboxes(db: Database): { name: string; owner: string }[] {
  const cutoff = new Date(Date.now() - SANDBOX_LEASE_MS).toISOString();
  return (db.query("SELECT name, auth_subject AS owner FROM computer_sandbox_owners WHERE created_at <= ?")
    .all(cutoff) as { name: string; owner: string }[]);
}

export function sandboxClaimed(db: Database, name: string): boolean {
  return !!db.query("SELECT name FROM computer_sandbox_owners WHERE name = ?").get(name);
}

export function reserveSandbox(db: Database, owner: string, name: string): string | null {
  return db.transaction(() => {
    if (sandboxClaimed(db, name)) return "sandbox_exists";
    const all = db.query("SELECT COUNT(*) AS count FROM computer_sandbox_owners").get() as { count: number };
    const mine = db.query("SELECT COUNT(*) AS count FROM computer_sandbox_owners WHERE auth_subject = ?").get(owner) as { count: number };
    if (all.count >= MAX_GLOBAL || mine.count >= MAX_PER_CLIENT) return "sandbox_quota_exceeded";
    ownSandbox(db, owner, name);
    return null;
  })();
}

export function ownSandbox(db: Database, owner: string, name: string): void {
  db.query("INSERT INTO computer_sandbox_owners (name, auth_kind, auth_subject, created_at) VALUES (?, ?, ?, ?)")
    .run(name, "mcp", owner, new Date().toISOString());
}

export function forgetSandbox(db: Database, owner: string, name: string): void {
  db.query("DELETE FROM computer_sandbox_owners WHERE name = ? AND auth_subject = ?").run(name, owner);
}
