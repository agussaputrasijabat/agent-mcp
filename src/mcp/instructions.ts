import { readFileSync } from "node:fs";
import { resourceText } from "../resources.ts";

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
