import { lookup } from "node:dns/promises";
import * as z from "zod/v4";
import { WEB_FETCH_MAX_REDIRECTS, WEB_FETCH_TIMEOUT_MS } from "../limits.ts";
import { fail, ok, type ToolResult } from "./result.ts";

export const webFetchInput = z.object({
  url: z.string(),
});

type Lookup = (hostname: string) => Promise<string[]>;
type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const defaultLookup: Lookup = async (hostname) => {
  if (isIpLiteral(hostname)) return [hostname];
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

export async function fetchUrl(
  input: z.infer<typeof webFetchInput>,
  deps: { fetch?: FetchLike; lookup?: Lookup } = {},
): Promise<ToolResult> {
  let current: URL;
  try {
    current = new URL(input.url);
  } catch {
    return fail("fetch_failed", "url is not valid");
  }
  if (current.protocol !== "http:" && current.protocol !== "https:") {
    return fail("fetch_blocked", "only http and https URLs are allowed");
  }
  if (current.username || current.password) return fail("fetch_blocked", "urls with userinfo are blocked");

  const doFetch = deps.fetch ?? fetch;
  const doLookup = deps.lookup ?? defaultLookup;
  const deadline = AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS);

  try {
    for (let hop = 0; hop <= WEB_FETCH_MAX_REDIRECTS; hop += 1) {
      const resolved = await resolvePublicAddress(current, doLookup);
      if (typeof resolved !== "string") return resolved;
      const response = await doFetch(pinnedUrl(current, resolved), {
        redirect: "manual",
        signal: deadline,
        headers: { host: current.host },
      });
      if (response.status >= 300 && response.status < 400) {
        if (hop === WEB_FETCH_MAX_REDIRECTS) return fail("fetch_failed", "too many redirects");
        const location = response.headers.get("location");
        if (!location) return fail("fetch_failed", "redirect is missing a location");
        current = new URL(location, current);
        if (current.username || current.password) return fail("fetch_blocked", "urls with userinfo are blocked");
        continue;
      }
      const body = await response.text();
      return ok(`status ${response.status}\n${body}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "request failed";
    console.error(JSON.stringify({ level: "error", msg: "web_fetch_failed", message }));
    return fail("fetch_failed", message);
  }
  return fail("fetch_failed", "request failed");
}

async function resolvePublicAddress(url: URL, doLookup: Lookup): Promise<string | ToolResult> {
  let addresses: string[];
  try {
    addresses = await doLookup(url.hostname);
  } catch (error) {
    const message = error instanceof Error ? error.message : "dns lookup failed";
    return fail("fetch_failed", message);
  }
  if (addresses.length === 0) return fail("fetch_failed", "dns lookup returned no addresses");
  if (addresses.some((address) => isBlockedAddress(address))) {
    return fail("fetch_blocked", "url resolves to a private or loopback address");
  }
  const address = addresses[0];
  if (!address) return fail("fetch_failed", "dns lookup returned no addresses");
  return address;
}

function pinnedUrl(url: URL, address: string): URL {
  const next = new URL(url.href);
  next.hostname = address.includes(":") ? `[${address}]` : address;
  return next;
}

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

export function isBlockedAddress(address: string): boolean {
  const lower = address.toLowerCase();
  const ipv4 = ipv4Embedded(lower);
  if (ipv4) return isBlockedIpv4(ipv4);
  if (lower === "::1" || lower === "0:0:0:0:0:0:0:1") return true;
  if (/^f[cd]/.test(lower)) return true;
  if (isIpv6LinkLocal(lower) || isIpv6Multicast(lower)) return true;
  return false;
}

function ipv4Embedded(address: string): string | undefined {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(address)) return address;
  const mapped = /^::ffff:(?:0:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped?.[1]) return mapped[1];
  const compatible = /^::(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  return compatible?.[1];
}

function isBlockedIpv4(address: string): boolean {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  const c = parts[2] ?? 0;
  const d = parts[3] ?? 0;
  if (a === 0 && b === 0 && c === 0 && d === 0) return true;
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isIpv6LinkLocal(address: string): boolean {
  const first = address.split(":")[0];
  if (!first || !/^[0-9a-f]{1,4}$/.test(first)) return false;
  const value = Number.parseInt(first, 16);
  return value >= 0xfe80 && value <= 0xfebf;
}

function isIpv6Multicast(address: string): boolean {
  const first = address.split(":")[0];
  if (!first || !/^[0-9a-f]{1,4}$/.test(first)) return false;
  const value = Number.parseInt(first, 16);
  return value >= 0xff00 && value <= 0xffff;
}
