import { createHash, randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";

export type ApiKeyRow = {
  id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export function hashApiKey(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function createApiKey(db: Database, name: string): { row: ApiKeyRow; secret: string } {
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 64) {
    throw new KeyValidationError("name must be 1 to 64 characters");
  }
  const secret = `amcp_${randomBytes(32).toString("base64url")}`;
  const now = new Date().toISOString();
  const row: ApiKeyRow = {
    id: crypto.randomUUID(),
    name: trimmed,
    key_prefix: secret.slice(0, 12),
    key_hash: hashApiKey(secret),
    created_at: now,
    last_used_at: null,
    revoked_at: null,
  };
  db.query(
    `INSERT INTO api_keys (id, name, key_prefix, key_hash, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL, NULL)`,
  ).run(row.id, row.name, row.key_prefix, row.key_hash, row.created_at);
  return { row, secret };
}

export function findActiveApiKey(db: Database, secret: string): ApiKeyRow | undefined {
  const row = db.query("SELECT * FROM api_keys WHERE key_hash = ?").get(hashApiKey(secret)) as ApiKeyRow | null;
  if (!row || row.revoked_at) return undefined;
  db.query("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
  return row;
}

export function revokeApiKey(db: Database, id: string): ApiKeyRow | undefined {
  const row = db.query("SELECT * FROM api_keys WHERE id = ?").get(id) as ApiKeyRow | null;
  if (!row) return undefined;
  if (!row.revoked_at) {
    const revokedAt = new Date().toISOString();
    db.query("UPDATE api_keys SET revoked_at = ? WHERE id = ?").run(revokedAt, id);
    row.revoked_at = revokedAt;
  }
  return row;
}

export class KeyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KeyValidationError";
  }
}
