const chatHeading = "## Instruksi untuk ChatGPT dan Claude\n";
const serverHeading = "\n## Instruksi server MCP";

export function chatInstructions(markdown: string): string {
  const text = markdown.replaceAll("\r\n", "\n");
  const start = text.indexOf(chatHeading);
  if (start < 0) throw new Error("chat_instructions_missing");
  const body = text.slice(start + chatHeading.length);
  const end = body.indexOf(serverHeading);
  if (end < 0) throw new Error("chat_instructions_missing");
  return body.slice(0, end).trim();
}

export function fillProjectPrompt(section: string, projectRoot: string, mcpName: string): string {
  return section.replace(/PROJECT_ROOT|MCP_NAME/g, (token) => (token === "PROJECT_ROOT" ? projectRoot : mcpName));
}
