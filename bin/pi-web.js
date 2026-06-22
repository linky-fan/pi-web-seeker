#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseArgs } = require("util");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

const { values: cliArgs } = parseArgs({
  options: {
    port:     { type: "string", short: "p" },
    hostname: { type: "string", short: "H" },
  },
  strict: false,
});

const port     = cliArgs.port     ?? process.env.PORT             ?? "30141";
const hostname = cliArgs.hostname ?? process.env.PI_WEB_BIND_HOST ?? "0.0.0.0";

if (!fs.existsSync(nextDir)) {
  console.error([
    "Build artifacts not found.",
    "",
    "If you installed from npm, reinstall the published package:",
    "  npm install -g @agegr/pi-web",
    "",
    "If you installed from GitHub, reinstall so npm can run the prepare build:",
    "  npm install -g github:linky-fan/pi-web-seeker",
    "",
    "For a local checkout, run:",
    "  npm install",
    "  npm run build",
    "  pi-web",
  ].join("\n"));
  process.exit(1);
}

const nextArgs = ["start", "-p", port];
if (hostname) nextArgs.push("-H", hostname);

// Always run next's JS entry with node directly — avoids .bin symlink issues
// and path-with-spaces problems on Windows when shell: true is used.
const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: pkgDir,
  stdio: ["inherit", "pipe", "inherit"],
  env: { ...process.env, PI_WEB_APP_ROOT: pkgDir },
});

let browserOpened = false;
const openHost = hostname === "0.0.0.0" || hostname === "::" ? "localhost" : hostname;
const url = `http://${openHost}:${port}`;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (!browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";
    const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
    spawn(openCmd, [url], { shell: isWindows, stdio: "ignore", detached: true }).unref();
  }
});

child.on("exit", (code) => process.exit(code ?? 0));
