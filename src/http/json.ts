import type { Context } from "hono";

export function ok<T>(c: Context, data: T, status = 200) {
  return c.json({ data, error: null }, status);
}

export function fail(c: Context, status: number, code: string, message: string) {
  return c.json({ data: null, error: { code, message, details: {} } }, status);
}
