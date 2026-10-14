import { expect, test } from "bun:test";
import { chatInstructions, fillProjectPrompt } from "../web/src/project-prompt.ts";

const markdown = await Bun.file(new URL("../prompts/project-instructions.md", import.meta.url)).text();

test("chat section keeps the paste-ready prompt and drops the other sections", () => {
  const section = chatInstructions(markdown);
  expect(section.startsWith("Kamu agen coding.")).toBe(true);
  expect(section).toContain("PROJECT_ROOT");
  expect(section).toContain("MCP_NAME");
  expect(section).not.toContain("Tempel bagian");
  expect(section).not.toContain("Instruksi server MCP");
  expect(section).not.toContain("Maksimal 512");
});

test("fillProjectPrompt replaces both placeholders in one pass", () => {
  const section = chatInstructions(markdown);
  const filled = fillProjectPrompt(section, "/Users/agus/work/demo", "agen-laptop");
  expect(filled).not.toContain("PROJECT_ROOT");
  expect(filled).not.toContain("MCP_NAME");
  expect(filled).toContain("/Users/agus/work/demo");
  expect(filled).toContain("agen-laptop");
  expect(fillProjectPrompt("A PROJECT_ROOT B MCP_NAME", "/tmp/MCP_NAME", "box")).toBe("A /tmp/MCP_NAME B box");
  expect(fillProjectPrompt("A PROJECT_ROOT B MCP_NAME", "/tmp/app", "PROJECT_ROOT")).toBe("A /tmp/app B PROJECT_ROOT");
});
