import type { Database } from "bun:sqlite";
import {
  OUTPUT_CHAR_LIMIT,
  SHELL_CONCURRENCY,
  SHELL_TIMEOUT_MAX_MS,
  SHELL_TIMEOUT_MS,
} from "../limits.ts";

export type Settings = {
  public_base_url: string;
  shell_concurrency_limit: number;
  shell_timeout_ms: number;
  shell_timeout_max_ms: number;
  shell_policy: "risky" | "strict";
  output_char_limit: number;
};

const settingsCache = new WeakMap<Database, Settings>();

function querySettings(db: Database): Settings {
  const row = db.query("SELECT * FROM settings WHERE id = 1").get() as Settings | null;
  if (!row) throw new Error("settings_missing");
  settingsCache.set(db, row);
  return row;
}

export function ensureSettings(db: Database, publicBaseUrl: string): Settings {
  const existing = db.query("SELECT * FROM settings WHERE id = 1").get() as Settings | null;
  if (existing) {
    settingsCache.set(db, existing);
    return existing;
  }
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO settings (
      id, public_base_url, shell_concurrency_limit, shell_timeout_ms, shell_timeout_max_ms, output_char_limit, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?)`,
  ).run(publicBaseUrl, SHELL_CONCURRENCY, SHELL_TIMEOUT_MS, SHELL_TIMEOUT_MAX_MS, OUTPUT_CHAR_LIMIT, now);
  return readSettings(db);
}

export function readSettings(db: Database): Settings {
  return settingsCache.get(db) ?? querySettings(db);
}

export class SettingsError extends Error {
  constructor(readonly code: "public_url_not_https" | "validation_error", message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

export function updateSettings(db: Database, patch: Record<string, unknown>): Settings {
  const current = readSettings(db);
  const next = {
    public_base_url: current.public_base_url,
    shell_concurrency_limit: current.shell_concurrency_limit,
    shell_timeout_ms: current.shell_timeout_ms,
    shell_timeout_max_ms: current.shell_timeout_max_ms,
    shell_policy: current.shell_policy,
  };
  if ("public_base_url" in patch) {
    if (typeof patch.public_base_url !== "string") throw new SettingsError("validation_error", "public_base_url must be a URL");
    const code = publicUrlError(patch.public_base_url);
    if (code) throw new SettingsError(code, code === "public_url_not_https" ? "Public URL must use HTTPS" : "public_base_url must be a URL");
    next.public_base_url = patch.public_base_url;
  }
  if ("shell_concurrency_limit" in patch) next.shell_concurrency_limit = integerField(patch.shell_concurrency_limit, 1, 128);
  if ("shell_timeout_ms" in patch) next.shell_timeout_ms = integerField(patch.shell_timeout_ms, 1000, 2_000_000_000);
  if ("shell_timeout_max_ms" in patch) next.shell_timeout_max_ms = integerField(patch.shell_timeout_max_ms, 1000, 2_000_000_000);
  if ("shell_policy" in patch) {
    if (patch.shell_policy !== "risky" && patch.shell_policy !== "strict") {
      throw new SettingsError("validation_error", "shell_policy must be risky or strict");
    }
    next.shell_policy = patch.shell_policy;
  }
  if (next.shell_timeout_ms > next.shell_timeout_max_ms) {
    throw new SettingsError("validation_error", "shell_timeout_ms cannot exceed shell_timeout_max_ms");
  }
  db.query(
    `UPDATE settings
     SET public_base_url = ?, shell_concurrency_limit = ?, shell_timeout_ms = ?, shell_timeout_max_ms = ?, shell_policy = ?, updated_at = ?
     WHERE id = 1`,
  ).run(next.public_base_url, next.shell_concurrency_limit, next.shell_timeout_ms, next.shell_timeout_max_ms, next.shell_policy, new Date().toISOString());
  settingsCache.delete(db);
  return readSettings(db);
}

function integerField(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new SettingsError("validation_error", `value must be an integer from ${min} to ${max}`);
  }
  return value;
}

function publicUrlError(value: string): "public_url_not_https" | "validation_error" | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "validation_error";
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol === "http:" && loopback) return null;
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:") return "public_url_not_https";
  return "validation_error";
}
