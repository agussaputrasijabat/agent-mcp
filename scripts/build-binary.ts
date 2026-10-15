import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = join(import.meta.dir, "..");
const paths = [
  "prompts/server-instructions.txt",
  "web/public/favicon.svg",
  "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
];
for (const dir of ["migrations", "prompts/packs", "skills/ecc", "dist/web", "dist/web/assets"]) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    if (entry.isFile()) paths.push(`${dir}/${entry.name}`);
  }
}

const resources: Record<string, string> = {};
for (const name of paths.sort()) resources[name] = readFileSync(join(root, name)).toString("base64");

const entry = join(root, "src/generated/binary-entry.ts");
mkdirSync(dirname(entry), { recursive: true });
writeFileSync(entry, `import { registerBundledResources } from "../resources.ts";\nregisterBundledResources(${JSON.stringify(resources)});\nawait import("../cli/main.ts");\n`);

const target = process.argv[2] ?? "";
if (target && !/^bun-(darwin|windows|linux)-(x64|arm64)(-baseline|-modern|-musl)?$/.test(target)) {
  throw new Error("unsupported build target");
}
const platform = target.includes("windows") ? "win32" : target.includes("darwin") ? "darwin" : target.includes("linux") ? "linux" : process.platform;
const arch = target.includes("arm64") ? "arm64" : target.includes("x64") ? "x64" : process.arch;
const output = join(root, "dist/bin", `${platform}-${arch}`, platform === "win32" ? "agent-mcp.exe" : "agent-mcp");
mkdirSync(dirname(output), { recursive: true });
const command = ["bun", "build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig", "--minify", ...(target ? [`--target=${target}`] : []), entry, "--outfile", output];
const processHandle = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit" });
if (await processHandle.exited !== 0) process.exit(1);
console.log(`Created ${output}`);
