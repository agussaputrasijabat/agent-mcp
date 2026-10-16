import { realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";

function matchesSensitiveName(path: string): boolean {
  return /(?:^|[/\\])(?:\.env(?:\.[^/\\]*)?|id_(?:rsa|ed25519|ecdsa)|authorized_keys|known_hosts|credentials(?:\.[^/\\]*)?|secrets?(?:\.[^/\\]*)?|[^/\\]+\.(?:pem|key|p12|pfx))$/i.test(path)
    || /(?:^|[/\\])\.ssh(?:[/\\]|$)/i.test(path);
}

export function sensitivePath(path: string): boolean {
  if (matchesSensitiveName(path)) return true;
  try {
    return matchesSensitiveName(realpathSync(path));
  } catch {
    try { return matchesSensitiveName(join(realpathSync(dirname(path)), basename(path))); }
    catch { return false; }
  }
}
