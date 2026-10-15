import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SetupInstructionsGuide, setupGuides } from "../web/src/setup-guide.tsx";

test("setup guide documents project instructions for ChatGPT and Claude", () => {
  const chatgpt = setupGuides.chatgpt;
  const claude = setupGuides.claude;

  expect(chatgpt.steps).toHaveLength(4);
  expect(chatgpt.steps[1]?.description).toContain("Project settings");
  expect(chatgpt.helpUrl).toContain("help.openai.com");
  expect(claude.steps).toHaveLength(4);
  expect(claude.steps[1]?.description).toContain("Set project instructions");
  expect(claude.steps[2]?.description).toContain("Save instructions");
  expect(claude.helpUrl).toContain("support.claude.com");
});

test("setup guide explains prerequisites and only confirms completed instructions", () => {
  const incomplete = renderToStaticMarkup(createElement(SetupInstructionsGuide, { ready: false, mcpName: "" }));
  expect(incomplete).toContain("Lengkapi Nama MCP");
  expect(incomplete).toContain("get_instructions");
  expect(incomplete).toContain("hubungkan Agent MCP sebagai konektor");
  expect(incomplete).toContain("Panduan konektor MCP");

  const complete = renderToStaticMarkup(createElement(SetupInstructionsGuide, { ready: true, mcpName: "Agent Macbook" }));
  expect(complete).toContain("Agent Macbook");
  expect(complete).toContain("sudah siap disalin");
  expect(complete).not.toContain("Lengkapi Nama MCP");
});
