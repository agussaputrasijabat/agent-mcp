import type { Database } from "bun:sqlite";

export type ComputerSettings = {
  driver_observe: boolean;
  driver_control: boolean;
  sandbox_observe: boolean;
  sandbox_manage: boolean;
};

const fields = ["driver_observe", "driver_control", "sandbox_observe", "sandbox_manage"] as const;

export function computerSettings(db: Database): ComputerSettings {
  const row = db.query("SELECT driver_observe, driver_control, sandbox_observe, sandbox_manage FROM computer_settings WHERE id = 1").get() as Record<typeof fields[number], number>;
  return Object.fromEntries(fields.map((field) => [field, row[field] === 1])) as ComputerSettings;
}

export function updateComputerSettings(db: Database, value: unknown): ComputerSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid computer settings");
  const patch = value as Record<string, unknown>;
  if (Object.keys(patch).some((field) => !fields.includes(field as typeof fields[number]))) throw new Error("Unknown computer setting");
  for (const field of fields) {
    if (field in patch && typeof patch[field] !== "boolean") throw new Error(field + " must be boolean");
  }
  const current = computerSettings(db);
  const next = { ...current, ...patch };
  if (!next.driver_observe && next.driver_control) throw new Error("Enable host observation before control");
  if (!next.sandbox_observe && next.sandbox_manage) throw new Error("Enable sandbox discovery before management");
  db.query(`UPDATE computer_settings
    SET driver_observe = ?, driver_control = ?, sandbox_observe = ?, sandbox_manage = ?, updated_at = ?
    WHERE id = 1`).run(
    +next.driver_observe, +next.driver_control, +next.sandbox_observe, +next.sandbox_manage, new Date().toISOString(),
  );
  return computerSettings(db);
}
