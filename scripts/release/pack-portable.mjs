#!/usr/bin/env node
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { chmod, cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { get } from "node:https";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const defaultNodeVersion = "24.18.0";

function parseArgs(argv) {
  const options = {
    platform: process.platform,
    arch: process.arch,
    nodeVersion: defaultNodeVersion,
    outputDir: "dist",
    cacheDir: ".release-cache/node",
    archive: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const readValue = () => {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      i += 1;
      return value;
    };

    if (arg === "--platform") options.platform = readValue();
    else if (arg === "--arch") options.arch = readValue();
    else if (arg === "--node-version") options.nodeVersion = readValue().replace(/^v/, "");
    else if (arg === "--output-dir") options.outputDir = readValue();
    else if (arg === "--cache-dir") options.cacheDir = readValue();
    else if (arg === "--no-archive") options.archive = false;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  options.platform = normalizePlatform(options.platform);
  options.arch = normalizeArch(options.arch);
  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/release/pack-portable.mjs [options]

Options:
  --platform <win32|darwin|windows|macos>  Target platform, default current platform
  --arch <x64|arm64>                       Target architecture, default current architecture
  --node-version <version>                 Bundled Node.js version, default ${defaultNodeVersion}
  --output-dir <dir>                       Output directory, default dist
  --cache-dir <dir>                        Download cache directory, default .release-cache/node
  --no-archive                             Create portable directory only, no zip
`);
}

function normalizePlatform(value) {
  if (value === "windows") return "win32";
  if (value === "macos" || value === "mac") return "darwin";
  if (value === "win32" || value === "darwin") return value;
  throw new Error(`Unsupported platform: ${value}. Expected win32/windows or darwin/macos.`);
}

function normalizeArch(value) {
  if (value === "x64" || value === "arm64") return value;
  throw new Error(`Unsupported arch: ${value}. Expected x64 or arm64.`);
}

function platformLabel(platform) {
  return platform === "win32" ? "windows" : "macos";
}

function nodeDistName({ platform, arch, nodeVersion }) {
  const platformPart = platform === "win32" ? "win" : "darwin";
  const extension = platform === "win32" ? "zip" : "tar.gz";
  return {
    base: `node-v${nodeVersion}-${platformPart}-${arch}`,
    extension,
  };
}

async function downloadFile(url, destination) {
  await mkdir(dirname(destination), { recursive: true });
  await new Promise((resolvePromise, rejectPromise) => {
    const request = get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
        response.resume();
        downloadFile(response.headers.location, destination).then(resolvePromise, rejectPromise);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        rejectPromise(new Error(`Download failed (${response.statusCode}) for ${url}`));
        return;
      }

      const tempDestination = `${destination}.tmp`;
      const file = createWriteStream(tempDestination);
      response.pipe(file);
      file.on("finish", () => {
        file.close(async (error) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          try {
            await rename(tempDestination, destination);
            resolvePromise();
          } catch (renameError) {
            rejectPromise(renameError);
          }
        });
      });
      file.on("error", rejectPromise);
    });
    request.on("error", rejectPromise);
  });
}

async function ensureNodeRuntime(options, runtimeDir) {
  const { base, extension } = nodeDistName(options);
  const archiveName = `${base}.${extension}`;
  const cacheDir = resolve(projectDir, options.cacheDir);
  const archivePath = join(cacheDir, archiveName);
  const url = `https://nodejs.org/dist/v${options.nodeVersion}/${archiveName}`;

  if (!existsSync(archivePath)) {
    console.log(`Downloading ${url}`);
    await downloadFile(url, archivePath);
  } else {
    console.log(`Using cached ${archivePath}`);
  }

  const extractDir = join(cacheDir, `${base}-extract`);
  rmSync(extractDir, { recursive: true, force: true });
  mkdirSync(extractDir, { recursive: true });

  if (extension === "tar.gz") {
    execFileSync("tar", ["-xzf", archivePath, "-C", extractDir], { stdio: "inherit" });
  } else if (process.platform === "win32") {
    const psArchive = archivePath.replace(/'/g, "''");
    const psExtract = extractDir.replace(/'/g, "''");
    execFileSync("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Expand-Archive -LiteralPath '${psArchive}' -DestinationPath '${psExtract}' -Force`,
    ], { stdio: "inherit" });
  } else {
    execFileSync("unzip", ["-q", archivePath, "-d", extractDir], { stdio: "inherit" });
  }

  await cp(join(extractDir, base), runtimeDir, { recursive: true, force: true });
  const nodeBin = options.platform === "win32" ? join(runtimeDir, "node.exe") : join(runtimeDir, "bin", "node");
  if (existsSync(nodeBin)) await chmod(nodeBin, 0o755);
}

function shouldCopyNextPath(source) {
  const rel = relative(projectDir, source).split(sep).join("/");
  if (rel === ".next/cache" || rel.startsWith(".next/cache/")) return false;
  if (rel === ".next/dev" || rel.startsWith(".next/dev/") || rel.startsWith(".next/dev.")) return false;
  if (rel === ".next/types" || rel.startsWith(".next/types/")) return false;
  if (rel === ".next/trace" || rel === ".next/trace-build") return false;
  if (basename(source).startsWith("_events_")) return false;
  if (source.endsWith(".js.map")) return false;
  return true;
}

async function copyRequired(source, destination, options = {}) {
  const absoluteSource = resolve(projectDir, source);
  if (!existsSync(absoluteSource)) throw new Error(`Required release input missing: ${source}`);
  console.log(`Copying ${source}`);
  await cp(absoluteSource, destination, {
    recursive: true,
    force: true,
    filter: options.filter,
  });
}

async function copyOptional(source, destination, options = {}) {
  const absoluteSource = resolve(projectDir, source);
  if (!existsSync(absoluteSource)) return;
  console.log(`Copying ${source}`);
  await cp(absoluteSource, destination, {
    recursive: true,
    force: true,
    filter: options.filter,
  });
}

async function writeLaunchers(packageDir, options) {
  const cmd = `@echo off
setlocal
set "APP_DIR=%~dp0"
set "NODE=%APP_DIR%runtime\\node\\node.exe"
set "PI_WEB_APP_ROOT=%APP_DIR%"
if not defined PORT set "PORT=30141"
if not defined PI_WEB_BIND_HOST set "PI_WEB_BIND_HOST=0.0.0.0"
"%NODE%" "%APP_DIR%bin\\pi-web.js" %*
`;

  const ps1 = `$ErrorActionPreference = "Stop"
$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Node = Join-Path $AppDir "runtime\\node\\node.exe"
$env:PI_WEB_APP_ROOT = $AppDir
if (-not $env:PORT) { $env:PORT = "30141" }
if (-not $env:PI_WEB_BIND_HOST) { $env:PI_WEB_BIND_HOST = "0.0.0.0" }
& $Node (Join-Path $AppDir "bin\\pi-web.js") @args
exit $LASTEXITCODE
`;

  const command = `#!/bin/sh
set -eu
APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
export PI_WEB_APP_ROOT="$APP_DIR"
: "\${PORT:=30141}"
: "\${PI_WEB_BIND_HOST:=0.0.0.0}"
export PORT PI_WEB_BIND_HOST
exec "$APP_DIR/runtime/node/bin/node" "$APP_DIR/bin/pi-web.js" "$@"
`;

  if (options.platform === "win32") {
    await writeFile(join(packageDir, "start-pi-web.cmd"), cmd, "utf8");
    await writeFile(join(packageDir, "start-pi-web.ps1"), ps1, "utf8");
  } else {
    const commandPath = join(packageDir, "start-pi-web.command");
    await writeFile(commandPath, command, "utf8");
    await chmod(commandPath, 0o755);
  }
}

async function writePortableReadme(packageDir, pkg, options) {
  const launcher = options.platform === "win32" ? "start-pi-web.cmd" : "start-pi-web.command";
  const text = `Pi Web Seeker portable release
Version: ${pkg.version}
Platform: ${platformLabel(options.platform)}-${options.arch}
Bundled Node.js: ${options.nodeVersion}

Start:
  ${launcher}

The launcher starts Pi Web Seeker on http://localhost:30141 and opens the browser.

Optional environment variables:
  PORT=8080
  PI_WEB_BIND_HOST=127.0.0.1
  PI_WEB_ACCESS_TOKEN=your-long-random-token

This package does not include user data, API keys, sessions, .env files, or local workspaces.
`;
  await writeFile(join(packageDir, "README-PORTABLE.txt"), text, "utf8");
}

async function archivePackage(packageDir, zipPath) {
  rmSync(zipPath, { force: true });

  if (process.platform === "win32") {
    const psPackage = packageDir.replace(/'/g, "''");
    const psZip = zipPath.replace(/'/g, "''");
    execFileSync("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `Compress-Archive -LiteralPath '${psPackage}' -DestinationPath '${psZip}' -Force`,
    ], { stdio: "inherit" });
  } else if (process.platform === "darwin") {
    execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", packageDir, zipPath], { stdio: "inherit" });
  } else {
    execFileSync("zip", ["-qr", zipPath, basename(packageDir)], { cwd: dirname(packageDir), stdio: "inherit" });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(await readFile(resolve(projectDir, "package.json"), "utf8"));
  const outDir = resolve(projectDir, options.outputDir);
  const packageName = `pi-web-seeker-v${pkg.version}-${platformLabel(options.platform)}-${options.arch}`;
  const packageDir = join(outDir, packageName);
  const zipPath = join(outDir, `${packageName}.zip`);

  for (const requiredPath of [".next", "node_modules", "bin/pi-web.js", "next.config.mjs", "package.json"]) {
    if (!existsSync(resolve(projectDir, requiredPath))) throw new Error(`Cannot package before build/install; missing ${requiredPath}`);
  }
  if (!statSync(resolve(projectDir, ".next")).isDirectory()) throw new Error(".next is not a directory");

  rmSync(packageDir, { recursive: true, force: true });
  await mkdir(packageDir, { recursive: true });

  await copyRequired("bin", join(packageDir, "bin"));
  await copyRequired(".next", join(packageDir, ".next"), { filter: shouldCopyNextPath });
  await copyRequired("node_modules", join(packageDir, "node_modules"));
  await copyRequired("next.config.mjs", join(packageDir, "next.config.mjs"));
  await copyRequired("package.json", join(packageDir, "package.json"));
  await copyOptional("package-lock.json", join(packageDir, "package-lock.json"));
  await copyOptional("templates", join(packageDir, "templates"));
  await copyOptional("pi-packages", join(packageDir, "pi-packages"));
  await copyOptional("public", join(packageDir, "public"));

  await mkdir(join(packageDir, "scripts"), { recursive: true });
  for (const script of [
    "scripts/agents-md.mjs",
    "scripts/coms-net-server.mjs",
    "scripts/model-context-test.mjs",
    "scripts/next-build.mjs",
    "scripts/prepare-github-install.js",
    "scripts/patch-pi-ai-stepfun-cache.mjs",
  ]) {
    await copyOptional(script, join(packageDir, script));
  }

  console.log(`Bundling Node.js ${options.nodeVersion} for ${platformLabel(options.platform)}-${options.arch}`);
  await ensureNodeRuntime(options, join(packageDir, "runtime", "node"));
  console.log("Writing launchers");
  await writeLaunchers(packageDir, options);
  await writePortableReadme(packageDir, pkg, options);

  if (options.archive) {
    console.log(`Creating ${zipPath}`);
    await archivePackage(packageDir, zipPath);
    console.log(`wrote ${zipPath}`);
  } else {
    console.log(`wrote ${packageDir}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
