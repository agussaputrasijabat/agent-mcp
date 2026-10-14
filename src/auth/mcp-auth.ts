import type { Database } from "bun:sqlite";
import { findActiveApiKey } from "./keys.ts";

export type McpAuthOk = { ok: true; kind: "api_key"; subject: string } | { ok: true; kind: "oauth" };
export type McpAuthNo = { ok: false; status: number; code: string; message: string };

const resourceMetadata = (baseUrl: string) =>
  `Bearer resource_metadata="${baseUrl.replace(/\/$/, "")}/.well-known/oauth-protected-resource"`;

export function decideMcpAuth(request: Request, db: Database, baseUrl: string): McpAuthOk | McpAuthNo {
  const url = new URL(request.url);
  if (url.searchParams.has("access_token") || url.searchParams.has("token")) {
    return { ok: false, status: 400, code: "query_token_rejected", message: "OAuth tokens are not accepted in the query string" };
  }

  const queryKey = url.searchParams.get("api_key");
  const headerKey = request.headers.get("x-api-key");
  const authorization = request.headers.get("authorization") ?? "";
  const bearer = authorization.toLowerCase().startsWith("bearer ") ? authorization.slice("bearer ".length).trim() : "";
  const bearerKey = bearer.startsWith("amcp_") ? bearer : "";

  if (queryKey && !bearerKey && !headerKey && !isLocalHttp(url)) {
    return { ok: false, status: 400, code: "https_required", message: "api_key on a public host requires HTTPS" };
  }

  if (bearer && !bearer.startsWith("amcp_")) {
    return { ok: true, kind: "oauth" };
  }

  const presented = bearerKey || headerKey || queryKey;
  if (!presented) {
    return { ok: false, status: 401, code: "missing_credentials", message: "An API key or access token is required" };
  }
  if (!presented.startsWith("amcp_")) {
    return { ok: false, status: 401, code: "invalid_api_key", message: "The credential is not a valid API key" };
  }
  const row = findActiveApiKey(db, presented);
  if (!row) return { ok: false, status: 401, code: "invalid_api_key", message: "The API key is unknown or revoked" };
  return { ok: true, kind: "api_key", subject: row.id };
}

export function mcpAuthResponse(decision: McpAuthNo, baseUrl: string): Response {
  const headers = new Headers({ "content-type": "application/json" });
  if (decision.status === 401) headers.set("www-authenticate", resourceMetadata(baseUrl));
  return new Response(
    JSON.stringify({ data: null, error: { code: decision.code, message: decision.message, details: {} } }),
    { status: decision.status, headers },
  );
}

function isLocalHttp(url: URL): boolean {
  const host = url.hostname;
  return url.protocol === "https:" || host === "localhost" || host === "127.0.0.1";
}
