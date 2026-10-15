import { expect, test } from "bun:test";
import { fillStub, instructionsUrl, PROJECT_INSTRUCTIONS_LIMIT, publicOrigin } from "../web/src/project-prompt.ts";

const stub = await Bun.file(new URL("../prompts/project-stub.md", import.meta.url)).text();
const values = {
  root: "/Users/agus/work/demo",
  name: "agen-laptop",
  mode: "coding" as const,
  url: "https://mcp.example.com/instructions/coding.md",
  notes: "",
};

test("fillStub replaces every placeholder and points the model at get_instructions", () => {
  const filled = fillStub(stub, values);
  for (const token of ["PROJECT_ROOT", "MCP_NAME", "MODE", "INSTRUCTIONS_URL", "PROJECT_NOTES"]) expect(filled).not.toContain(token);
  expect(filled).toContain("/Users/agus/work/demo");
  expect(filled).toContain("agen-laptop");
  expect(filled).toContain('mode "coding"');
  expect(filled).toContain("get_instructions");
  expect(filled).toContain(values.url);
  expect(filled).not.toContain("## Project notes");
});

test("fillStub keeps notes only when given and never re-substitutes values", () => {
  const filled = fillStub(stub, { ...values, notes: "Run bun test before commit." });
  expect(filled).toContain("## Project notes");
  expect(filled.endsWith("Run bun test before commit.")).toBe(true);
  const tricky = fillStub(stub, { ...values, root: "/tmp/MCP_NAME", name: "PROJECT_ROOT" });
  expect(tricky).toContain("Workspace: /tmp/MCP_NAME");
  expect(tricky).toContain("MCP connector: PROJECT_ROOT");
});

test("general mode without a folder tells the model to ask", () => {
  const filled = fillStub(stub, { ...values, root: "", mode: "general", url: instructionsUrl("https://mcp.example.com/", "general") });
  expect(filled).toContain("Workspace: not set; ask the user which folder to use");
  expect(filled).toContain("https://mcp.example.com/instructions/general.md");
});

test("stub leaves most of the ChatGPT limit for project notes", () => {
  const filled = fillStub(stub, { ...values, root: `/${"a".repeat(255)}`, name: "n".repeat(64) });
  expect(filled.length).toBeLessThan(2000);
  expect(filled.length).toBeLessThan(PROJECT_INSTRUCTIONS_LIMIT);
});

test("without a public URL the fallback paragraph is dropped", () => {
  const filled = fillStub(stub, { ...values, url: "" });
  expect(filled).not.toContain("INSTRUCTIONS_URL");
  expect(filled).not.toContain("If MCP_NAME is not available");
  expect(filled).not.toContain("is not available, read");
  expect(filled).toContain("If you cannot get the instructions");
});

test("publicOrigin only accepts public HTTPS hosts", () => {
  expect(publicOrigin("https:", "mcp.example.com")).toBe(true);
  expect(publicOrigin("http:", "mcp.example.com")).toBe(false);
  for (const host of ["localhost", "app.localhost", "printer.local", "127.0.0.1", "10.0.0.5", "172.20.1.1", "192.168.1.9", "169.254.1.1", "[::1]", "[fd00::1]", "0.0.0.0"]) {
    expect(publicOrigin("https:", host)).toBe(false);
  }
  expect(publicOrigin("https:", "172.32.0.1")).toBe(true);
});
