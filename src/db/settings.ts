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
  output_char_limit: number;
};

export function ensureSettings(db: Database, publicBaseUrl: string): Settings {
  const existing = db.query("SELECT * FROM settings WHERE id = 1").get() as Settings | null;
  if (existing) return existing;
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO settings (
      id, public_base_url, shell_concurrency_limit, shell_timeout_ms, shell_timeout_max_ms, output_char_limit, updated_at
    ) VALUES (1, ?, ?, ?, ?, ?, ?)`,
  ).run(publicBaseUrl, SHELL_CONCURRENCY, SHELL_TIMEOUT_MS, SHELL_TIMEOUT_MAX_MS, OUTPUT_CHAR_LIMIT, now);
  return readSettings(db);
}

export function readSettings(db: Database): Settings {
  const row = db.query("SELECT * FROM settings WHERE id = 1").get() as Settings | null;
  if (!row) throw new Error("settings_missing");
  return row;
}
