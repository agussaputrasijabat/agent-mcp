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

export function clientIp(request: Request, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) return forwarded.split(",")[0]?.trim() || "local";
  }
  return "local";
}
