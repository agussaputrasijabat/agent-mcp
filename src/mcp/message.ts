export function parseMcpBody(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const data = trimmed
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .at(-1);
  if (!data) throw new Error(trimmed);
  return JSON.parse(data);
}
