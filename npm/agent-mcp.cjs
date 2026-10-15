#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const platform = `${process.platform}-${process.arch}`;
const name = process.platform === "win32" ? "agent-mcp.exe" : "agent-mcp";
const sourceBinary = join(__dirname, "..", "dist", "bin", platform, name);
const packagedBinary = join(__dirname, "native", platform, name);
const binary = existsSync(packagedBinary) ? packagedBinary : sourceBinary;

if (!existsSync(binary)) {
  console.error(`Agent MCP: binary untuk ${platform} tidak tersedia dalam paket ini.`);
  console.error("Instal paket yang dibangun untuk sistem operasi dan arsitektur ini.");
  process.exitCode = 1;
} else {
  const child = spawn(binary, process.argv.slice(2), { stdio: "inherit", windowsHide: false });
  child.on("error", (error) => {
    console.error(`Agent MCP: gagal menjalankan binary: ${error.message}`);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => { if (!child.killed) child.kill(signal); });
  }
}
