export const PROJECT_INSTRUCTIONS_LIMIT = 8000;

export type StubMode = "coding" | "general";

export type StubValues = {
  root: string;
  name: string;
  mode: StubMode;
  url: string;
  notes: string;
};

const notesHeading = "\n## Project notes";
const unsetRoot = "not set; ask the user which folder to use";
const tokens = /PROJECT_ROOT|MCP_NAME|MODE|INSTRUCTIONS_URL|PROJECT_NOTES/g;

/** ChatGPT and Claude fetch from the cloud, so only a public HTTPS origin makes a usable fallback URL. */
export function publicOrigin(protocol: string, hostname: string): boolean {
  if (protocol !== "https:") return false;
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1" || host === "0.0.0.0") return false;
  if (/^(127|10)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (/^f[cd][0-9a-f]{2}:/.test(host) || /^fe[89ab][0-9a-f]:/.test(host)) return false;
  return true;
}

export function instructionsUrl(origin: string, mode: StubMode): string {
  return `${origin.replace(/\/+$/, "")}/instructions/${mode}.md`;
}

export function fillStub(template: string, values: StubValues): string {
  let text = template.replaceAll("\r\n", "\n").trim();
  const notes = values.notes.trim();
  if (!notes) {
    const cut = text.indexOf(notesHeading);
    if (cut >= 0) text = text.slice(0, cut).trimEnd();
  }
  if (!values.url) {
    text = text.split("\n\n").filter((paragraph) => !paragraph.includes("INSTRUCTIONS_URL")).join("\n\n");
  }
  const replacements: Record<string, string> = {
    PROJECT_ROOT: values.root.trim() || unsetRoot,
    MCP_NAME: values.name.trim(),
    MODE: values.mode,
    INSTRUCTIONS_URL: values.url,
    PROJECT_NOTES: notes,
  };
  return text.replace(tokens, (token) => replacements[token] ?? token);
}
