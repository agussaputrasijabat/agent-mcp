import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createOperatorAuth, seedOperator } from "../auth/operator.ts";
import { openDatabase } from "../db/database.ts";
import { saveConfig, type CliConfig } from "./config.ts";
import { dataDirectory } from "./paths.ts";

const databasePath = () => join(dataDirectory(), "agent.sqlite");

export function operatorReady(config: CliConfig): boolean {
  if (!existsSync(databasePath())) return false;
  const db = new Database(databasePath(), { readonly: true });
  try {
    const tables = db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('user', 'account')").all();
    if (tables.length !== 2) return false;
    return !!db.query(`
      SELECT user.id FROM user JOIN account ON account.userId = user.id
      WHERE user.email = ? AND account.providerId = 'credential' AND account.password IS NOT NULL
      LIMIT 1
    `).get(config.email);
  } finally {
    db.close();
  }
}

export async function completeSetup(config: CliConfig, password: string): Promise<void> {
  if (password.length < 12) throw new Error("password_too_short");
  const db = openDatabase(databasePath());
  try {
    const auth = await createOperatorAuth(db, {
      secret: config.secret,
      baseURL: `http://127.0.0.1:${config.port}`,
      port: config.port,
    });
    await seedOperator(auth, db, config.email, password);
  } finally {
    db.close();
  }
  saveConfig(config);
}
