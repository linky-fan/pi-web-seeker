#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { execFileSync } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

const pkgDir = path.resolve(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");
const initCwd = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : "";
const isLocalDevInstall = initCwd === pkgDir;
const forceBuild = process.env.PI_WEB_PREPARE_BUILD === "1";
const skipBuild = process.env.PI_WEB_SKIP_PREPARE_BUILD === "1";

if (skipBuild) {
  console.log("pi-web-seeker: skipping prepare build because PI_WEB_SKIP_PREPARE_BUILD=1");
  process.exit(0);
}

if (!forceBuild && isLocalDevInstall) {
  console.log("pi-web-seeker: skipping prepare build for local development install");
  process.exit(0);
}

if (fs.existsSync(nextDir)) {
  console.log("pi-web-seeker: existing .next build found; skipping prepare build");
  process.exit(0);
}

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
console.log("pi-web-seeker: building Next.js artifacts for GitHub install");
execFileSync(npmCmd, ["run", "build"], {
  cwd: pkgDir,
  stdio: "inherit",
});
