import { readFileSync } from "node:fs";
import { join } from "node:path";

const instructionsPath = join(import.meta.dir, "../../prompts/server-instructions.txt");

export function readServerInstructions(path = instructionsPath): string {
  return readFileSync(path, "utf8").trim();
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
