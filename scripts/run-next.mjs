#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(pkgDir, "package.json"));
const { assertNetworkAccessConfigured } = require("./scripts/network-security.cjs");
const command = process.argv[2];

if (command !== "dev" && command !== "start") {
  console.error("Usage: node scripts/run-next.mjs <dev|start>");
  process.exit(2);
}

const port = process.env.PORT ?? "30141";
const hostname = process.env.PI_WEB_BIND_HOST?.trim() || "localhost";

try {
  assertNetworkAccessConfigured(hostname, process.env.PI_WEB_ACCESS_TOKEN);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next");
} catch {
  console.error("Next.js is not installed. Run npm install first.");
  process.exit(1);
}

const child = spawn(process.execPath, [nextBin, command, "-p", port, "-H", hostname], {
  cwd: pkgDir,
  stdio: "inherit",
  env: {
    ...process.env,
    PI_WEB_BIND_HOST: hostname,
    PI_WEB_APP_ROOT: pkgDir,
  },
});

child.on("error", (error) => {
  console.error(`Failed to start Next.js: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exitCode = code ?? 1;
  }
});
