import type { Context } from "hono";
import { getConnInfo } from "hono/bun";

export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(private readonly limit = 10, private readonly windowMs = 15 * 60 * 1000) {}

  tooMany(ip: string, now = Date.now()): boolean {
    return this.recent(ip, now).length >= this.limit;
  }

  recordFailure(ip: string, now = Date.now()): void {
    const recent = this.recent(ip, now);
    recent.push(now);
    this.failures.set(ip, recent);
  }

  private recent(ip: string, now: number): number[] {
    const windowStart = now - this.windowMs;
    return (this.failures.get(ip) ?? []).filter((time) => time >= windowStart);
  }
}

export function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      const appended = forwarded
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .at(-1);
      if (appended) return appended;
    }
  }
  // No Bun socket on Hono app.request(). That in-process client is 127.0.0.1.
  // Bun.serve supplies requestIP, so internet clients are not one shared key.
  return remoteAddress(c) ?? "127.0.0.1";
}

function remoteAddress(c: Context): string | undefined {
  try {
    const address = getConnInfo(c).remote.address?.trim();
    return address ? address : undefined;
  } catch (error) {
    if (error instanceof TypeError) return undefined;
    throw error;
  }
}
