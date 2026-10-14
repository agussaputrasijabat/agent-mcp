import { lookup } from "node:dns/promises";
import * as z from "zod/v4";
import { WEB_FETCH_MAX_REDIRECTS, WEB_FETCH_TIMEOUT_MS } from "../limits.ts";
import { fail, ok, type ToolResult } from "./result.ts";

export const webFetchInput = z.object({
  url: z.string(),
});

type Lookup = (hostname: string) => Promise<string[]>;

const defaultLookup: Lookup = async (hostname) => {
  if (isIpLiteral(hostname)) return [hostname];
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
};

export async function fetchUrl(
  input: z.infer<typeof webFetchInput>,
  deps: { fetch?: typeof fetch; lookup?: Lookup } = {},
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
      const blocked = await assertPublic(current, doLookup);
      if (blocked) return blocked;
      const response = await doFetch(current, { redirect: "manual", signal: deadline });
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

async function assertPublic(url: URL, doLookup: Lookup): Promise<ToolResult | undefined> {
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
  return undefined;
}

function isIpLiteral(hostname: string): boolean {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

export function isBlockedAddress(address: string): boolean {
  const lower = address.toLowerCase();
  const mapped = lower.startsWith("::ffff:") ? lower.slice("::ffff:".length) : lower;
  if (lower === "::1" || mapped === "::1") return true;
  if (/^f[cd]/.test(lower)) return true;
  const v4 = mapped.includes(".") ? mapped : "";
  const parts = v4.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}
