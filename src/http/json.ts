import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function ok<T, S extends ContentfulStatusCode = 200>(c: Context, data: T, status: S = 200 as S) {
  return c.json({ data, error: null }, status);
}

export function fail<S extends ContentfulStatusCode>(c: Context, status: S, code: string, message: string) {
  return c.json({ data: null, error: { code, message, details: {} } }, status);
}
