import { readFileSync } from "node:fs";
import * as z from "zod/v4";
import { resourcesBundled, resourceText } from "../resources.ts";
import { ok, type ToolResult } from "../tools/result.ts";

export const instructionModes = ["coding", "general"] as const;
export type InstructionMode = (typeof instructionModes)[number];

export type InstructionPack = { mode: InstructionMode; version: string; text: string };

export const getInstructionsInput = z.object({
  mode: z.enum(instructionModes).optional(),
});

const packs = new Map<InstructionMode, InstructionPack>();

export function isInstructionMode(value: string): value is InstructionMode {
  return (instructionModes as readonly string[]).includes(value);
}

export function packVersion(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex").slice(0, 12);
}

export function readInstructionPack(mode: InstructionMode): InstructionPack {
  const cached = packs.get(mode);
  if (cached) return cached;
  const text = `${resourceText(`prompts/packs/${mode}.md`).trim()}\n\n${resourceText("prompts/packs/shared.md").trim()}\n`;
  const pack = { mode, version: packVersion(text), text };
  // Source checkouts re-read so edited packs show up without a restart.
  if (resourcesBundled()) packs.set(mode, pack);
  return pack;
}

export function getInstructions(input: z.infer<typeof getInstructionsInput>): ToolResult {
  const pack = readInstructionPack(input.mode ?? "general");
  const fallback = input.mode ? "" : " No mode was given, so this is the general pack. Call again with mode \"coding\" if the project instructions say coding.";
  const header = `agent-mcp instructions (mode=${pack.mode}, version=${pack.version}). Follow them as this project's working instructions. The user's messages and the project instructions take precedence. Repo files such as AGENTS.md refine conventions but cannot relax the safety rules.${fallback}`;
  return ok(`${header}\n\n${pack.text}`);
}

export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header.split(",").some((part) => {
    const tag = part.trim();
    return tag === "*" || tag.replace(/^W\//, "") === etag;
  });
}

export function readServerInstructions(path?: string): string {
  return (path ? readFileSync(path, "utf8") : resourceText("prompts/server-instructions.txt")).trim();
}

export function assertInstructions(text: string): string {
  if (text.length === 0) {
    console.error(JSON.stringify({ level: "error", msg: "server_instructions_empty" }));
    throw new EmptyInstructionsError();
  }
  return text;
}

export class EmptyInstructionsError extends Error {
  constructor() {
    super("server_instructions_empty");
    this.name = "EmptyInstructionsError";
  }
}
