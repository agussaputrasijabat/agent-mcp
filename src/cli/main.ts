import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { readConfig, newSecret, type CliConfig } from "./config.ts";
import { dataDirectory } from "./paths.ts";
import { completeSetup, operatorReady } from "./setup.ts";
import { clearInstance, controlHandler, readInstance, requestControl, writeInstance } from "./control.ts";

const command = process.argv[2] ?? "start";
const logPath = () => join(dataDirectory(), "server.log");
const endpoint = (config: CliConfig) => `http://127.0.0.1:${config.port}`;

async function healthy(config: CliConfig): Promise<boolean> {
  try {
    const response = await fetch(endpoint(config) + "/health", { signal: AbortSignal.timeout(1200) });
    const body = await response.json() as { data?: { ok?: boolean } };
    return response.ok && body.data?.ok === true;
  } catch { return false; }
}

async function passwordPrompt(): Promise<string> {
  if (!process.stdin.isTTY) throw new Error("setup_requires_terminal");
  process.stdout.write("Password operator (minimal 12 karakter): ");
  process.stdin.setRawMode(true);
  let result = "";
  let onData: (chunk: Buffer) => void;
  let onEnd: () => void;
  let onError: (error: Error) => void;
  try {
    return await new Promise<string>((resolve, reject) => {
      onData = (chunk) => {
        for (const char of chunk.toString()) {
          if (char === "\r" || char === "\n") { process.stdout.write("\n"); resolve(result); return; }
          if (char === "\u0003") { reject(new Error("setup_cancelled")); return; }
          if (char === "\u007f" || char === "\b") result = result.slice(0, -1);
          else if (char >= " ") result += char;
        }
      };
      onEnd = () => reject(new Error("setup_cancelled"));
      onError = reject;
      process.stdin.on("data", onData);
      process.stdin.once("end", onEnd);
      process.stdin.once("error", onError);
      process.stdin.resume();
      process.stdin.ref();
    });
  } finally {
    process.stdin.off("data", onData!);
    process.stdin.off("end", onEnd!);
    process.stdin.off("error", onError!);
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

async function setup(): Promise<CliConfig> {
  const current = readConfig();
  if (current && operatorReady(current)) return current;
  if (!process.stdin.isTTY) throw new Error("first_run_requires_interactive_setup");
  let email = current?.email ?? "";
  if (!email) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { email = (await rl.question("Email operator: ")).trim(); }
    finally { rl.close(); }
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("invalid_email");
  const password = await passwordPrompt();
  if (password.length < 12) throw new Error("password_too_short");
  const config = current ?? { email, secret: newSecret(), port: 3000 };
  await completeSetup(config, password);
  return config;
}

async function runServer(): Promise<void> {
  const config = readConfig();
  if (!config) throw new Error("run_setup_first");
  process.env.HOST = "127.0.0.1";
  process.env.PORT = String(config.port);
  process.env.DATABASE_PATH = join(dataDirectory(), "agent.sqlite");
  process.env.BETTER_AUTH_SECRET = config.secret;
  process.env.DASHBOARD_EMAIL = config.email;
  delete process.env.DASHBOARD_PASSWORD;
  process.env.PUBLIC_BASE_URL = config.tunnel?.enabled && config.tunnel.url ? config.tunnel.url : endpoint(config);
  const { server, applicationFetch } = await import("../index.ts");
  const instance = { pid: process.pid, token: newSecret() };
  const shutdown = () => {
    clearInstance(instance);
    server.stop(true);
    process.exit(0);
  };
  const control = controlHandler(instance, shutdown);
  server.reload({ fetch: (request, server) => control(request) ?? applicationFetch(request, server) });
  writeInstance(instance);
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  process.once("exit", () => clearInstance(instance));
}

async function start(): Promise<void> {
  const config = await setup();
  const current = readInstance();
  if (current && await requestControl(config, current, "GET")) {
    console.log(`Agent MCP sudah berjalan di ${endpoint(config)}`);
    return;
  }
  // Do not bind over another service.
  if (await portInUse(config.port)) throw new Error("port_occupied");
  mkdirSync(dataDirectory(), { recursive: true, mode: 0o700 });
  const fd = openSync(logPath(), "a", 0o600);
  let child;
  try {
    child = spawn(process.execPath, ["__serve"], {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", fd, fd],
      env: { ...process.env, AGENT_MCP_HOME: dataDirectory() },
    });
  } finally { closeSync(fd); }
  if (!child.pid) throw new Error("spawn_failed");
  child.unref();
  for (let i = 0; i < 40; i++) {
    const instance = readInstance();
    if (instance?.pid === child.pid && await requestControl(config, instance, "GET")) {
      console.log(`Agent MCP aktif: ${endpoint(config)}`);
      return;
    }
    if (child.exitCode !== null) break;
    await Bun.sleep(250);
  }
  throw new Error(`server_failed_to_start; lihat ${logPath()}`);
}

async function portInUse(port: number): Promise<boolean> {
  const socket = Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {}, open(socket) { socket.end(); }, error() {} } });
  return socket.then(() => true).catch(() => false);
}

async function stop(): Promise<void> {
  const config = readConfig();
  const instance = readInstance();
  if (!instance || !config || !(await requestControl(config, instance, "POST"))) {
    console.log("Agent MCP tidak sedang berjalan, atau PID tidak dapat diverifikasi.");
    return;
  }
  for (let i = 0; i < 30 && await requestControl(config, instance, "GET"); i++) await Bun.sleep(100);
  if (await requestControl(config, instance, "GET")) throw new Error("server_stop_timeout");
  clearInstance(instance);
  console.log("Agent MCP dihentikan.");
}

async function main(): Promise<void> {
  if (command === "__serve") return runServer();
  if (command === "--help" || command === "help") {
    console.log("agent-mcp [start|stop|restart|status|logs|open|setup|--foreground|--version]");
    return;
  }
  if (command === "--version" || command === "version") { console.log("agent-mcp 1.0.0"); return; }
  if (command === "setup") { await setup(); return; }
  if (command === "start") return start();
  if (command === "stop") return stop();
  if (command === "restart") { await stop(); return start(); }
  if (command === "status") {
    const config = readConfig();
    console.log(config && await healthy(config) ? `Agent MCP berjalan (${endpoint(config)})` : "Agent MCP tidak berjalan");
    return;
  }
  if (command === "logs") {
    console.log(existsSync(logPath()) ? readFileSync(logPath(), "utf8").slice(-10000) : "Belum ada log.");
    return;
  }
  if (command === "open") {
    const config = readConfig();
    if (!config) throw new Error("run_setup_first");
    const browser = process.platform === "darwin" ? ["open", endpoint(config)] : process.platform === "win32" ? ["cmd", "/c", "start", "", endpoint(config)] : ["xdg-open", endpoint(config)];
    const child = spawn(browser[0]!, browser.slice(1), { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    return;
  }
  if (command === "--foreground") {
    await setup();
    return runServer();
  }
  throw new Error(`unknown_command:${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
