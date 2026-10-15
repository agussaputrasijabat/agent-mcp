import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const sourcePackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string;
  version: string;
};
const platform = process.platform;
const arch = process.arch;
const target = `${platform}-${arch}`;
const executable = platform === "win32" ? "agent-mcp.exe" : "agent-mcp";
const binary = join(root, "dist/bin", target, executable);
if (!existsSync(binary)) throw new Error(`compiled_binary_missing: ${binary}`);

const stage = join(root, "dist/npm/package");
const bin = join(stage, "bin");
const native = join(bin, "native", target);
mkdirSync(native, { recursive: true });

copyFileSync(join(root, "npm/agent-mcp.cjs"), join(bin, "agent-mcp.cjs"));
copyFileSync(binary, join(native, executable));
copyFileSync(join(root, "README.md"), join(stage, "README.md"));
copyFileSync(join(root, "LICENSE"), join(stage, "LICENSE"));
if (platform !== "win32") {
  chmodSync(join(bin, "agent-mcp.cjs"), 0o755);
  chmodSync(join(native, executable), 0o755);
}

writeFileSync(join(stage, "package.json"), JSON.stringify({
  name: sourcePackage.name,
  version: sourcePackage.version,
  description: "Agent MCP standalone CLI for ChatGPT and Claude",
  license: "MIT",
  repository: { type: "git", url: "https://github.com/agussaputrasijabat/agent-mcp.git" },
  bin: { "agent-mcp": "bin/agent-mcp.cjs" },
  os: [platform],
  cpu: [arch],
  engines: { node: ">=20" },
  files: ["bin", "LICENSE", "README.md"],
}, null, 2) + "\n");
console.log(`npm staging siap di ${stage}; tanpa dependensi runtime Node/Bun selain launcher Node.`);
console.log(`Buat paket: npm pack ${stage} --pack-destination ${join(root, "dist/npm")}`);
