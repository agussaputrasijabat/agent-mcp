import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDirectory } from "./paths.ts";

export type CliConfig = { email: string; secret: string; port: number; tunnel?: { enabled: boolean; url?: string } };
export const configPath = () => join(dataDirectory(), "config.json");

export function readConfig(): CliConfig | undefined {
  if (!existsSync(configPath())) return undefined;
  const raw: unknown = JSON.parse(readFileSync(configPath(), "utf8"));
  if (!raw || typeof raw !== "object") throw new Error("invalid_config");
  const config = raw as Partial<CliConfig>;
  if (!config.email || !config.secret || !Number.isInteger(config.port) || (config.port ?? 0) < 1 || (config.port ?? 0) > 65535) {
    throw new Error("invalid_config");
  }
  return config as CliConfig;
}

export function saveConfig(config: CliConfig): void {
  mkdirSync(dataDirectory(), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function newSecret(): string {
  return randomBytes(32).toString("hex");
}
