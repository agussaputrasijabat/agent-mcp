export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidName(value: string): boolean {
  return value.length >= 1 && value.length <= 64 && NAME_PATTERN.test(value);
}

export function likeContains(query: string): string {
  const escaped = query.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  return `%${escaped}%`;
}

export function normalizeProjectPath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path;
}
