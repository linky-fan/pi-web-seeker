import { existsSync, readFileSync, realpathSync } from "node:fs";
import { posix, win32 } from "node:path";

const SCRIPT_EXTENSIONS = new Set([".js", ".cjs", ".mjs"]);
const WINDOWS_NATIVE_EXTENSIONS = new Set([".exe", ".com"]);
const WINDOWS_SHIM_EXTENSIONS = new Set([".cmd", ".bat"]);

/** @typedef {"override" | "path-native" | "npm-entry" | "system-path"} OpenCliBinarySource */

/**
 * @typedef {object} OpenCliLaunchTarget
 * @property {string} command
 * @property {string[]} prefixArgs
 * @property {OpenCliBinarySource} source
 * @property {string} displayName
 */

/**
 * @typedef {object} OpenCliFileSystem
 * @property {(path: string) => boolean} exists
 * @property {(path: string) => string} readText
 * @property {(path: string) => string} realpath
 */

export class OpenCliResolutionError extends Error {
  /**
   * @param {"opencli_not_found" | "opencli_windows_shim_unresolved"} code
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = "OpenCliResolutionError";
    this.code = code;
  }
}

/** @returns {OpenCliFileSystem} */
function defaultFileSystem() {
  return {
    exists: existsSync,
    readText: (path) => readFileSync(path, "utf8"),
    realpath: (path) => realpathSync.native(path),
  };
}

/**
 * Windows environment variable names are case-insensitive, but Node preserves
 * the casing supplied by the parent process.
 * @param {Record<string, string | undefined>} env
 * @param {string} name
 */
function envValue(env, name) {
  const exact = env[name];
  if (exact !== undefined) return exact;
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key] : undefined;
}

/** @param {string} value */
function unquote(value) {
  const trimmed = value.trim();
  return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')
    ? trimmed.slice(1, -1)
    : trimmed;
}

/**
 * @param {string} value
 * @param {import("node:path").PlatformPath} pathApi
 */
function extension(value, pathApi) {
  return pathApi.extname(value).toLowerCase();
}

/**
 * @param {string} root
 * @param {import("node:path").PlatformPath} pathApi
 * @param {OpenCliFileSystem} fs
 */
function resolvePackageEntry(root, pathApi, fs) {
  const packageDir = pathApi.join(root, "node_modules", "@jackwener", "opencli");
  const manifestPath = pathApi.join(packageDir, "package.json");
  if (!fs.exists(manifestPath)) return null;

  try {
    const manifest = JSON.parse(fs.readText(manifestPath));
    const binValue = typeof manifest.bin === "string"
      ? manifest.bin
      : manifest.bin && typeof manifest.bin === "object"
        ? manifest.bin.opencli
        : undefined;
    if (typeof binValue !== "string" || !binValue.trim()) return null;

    const entry = pathApi.resolve(packageDir, binValue);
    const relativeEntry = pathApi.relative(packageDir, entry);
    if (!relativeEntry || relativeEntry.startsWith("..") || pathApi.isAbsolute(relativeEntry)) return null;
    if (!SCRIPT_EXTENSIONS.has(extension(entry, pathApi)) || !fs.exists(entry)) return null;

    const realPackageDir = fs.realpath(packageDir);
    const realEntry = fs.realpath(entry);
    const realRelativeEntry = pathApi.relative(realPackageDir, realEntry);
    if (!realRelativeEntry || realRelativeEntry.startsWith("..") || pathApi.isAbsolute(realRelativeEntry)) return null;
    return realEntry;
  } catch {
    return null;
  }
}

/**
 * @param {string} directory
 * @param {OpenCliFileSystem} fs
 */
function windowsCandidates(directory, fs) {
  return ["opencli.exe", "opencli.com", "opencli.cmd", "opencli.bat", "opencli"]
    .map((name) => win32.join(directory, name))
    .filter((candidate) => fs.exists(candidate));
}

/**
 * @param {string} candidate
 * @param {OpenCliBinarySource} source
 * @param {string} nodeExecutable
 * @param {OpenCliFileSystem} fs
 * @returns {OpenCliLaunchTarget | null}
 */
function windowsTarget(candidate, source, nodeExecutable, fs) {
  const ext = extension(candidate, win32);
  if (WINDOWS_NATIVE_EXTENSIONS.has(ext) || (!ext && fs.exists(candidate))) {
    return { command: candidate, prefixArgs: [], source, displayName: "OpenCLI" };
  }
  if (SCRIPT_EXTENSIONS.has(ext)) {
    if (!fs.exists(candidate)) return null;
    return { command: nodeExecutable, prefixArgs: [candidate], source, displayName: "Node.js · OpenCLI" };
  }
  if (!WINDOWS_SHIM_EXTENSIONS.has(ext)) return null;
  const entry = resolvePackageEntry(win32.dirname(candidate), win32, fs);
  if (!entry) return null;
  return {
    command: nodeExecutable,
    prefixArgs: [entry],
    source: source === "override" ? "override" : "npm-entry",
    displayName: "Node.js · @jackwener/opencli",
  };
}

/**
 * Resolve the executable without invoking a shell. Options are injectable so
 * Windows npm layouts can be tested on other platforms.
 * @param {object} [options]
 * @param {NodeJS.Platform} [options.platform]
 * @param {Record<string, string | undefined>} [options.env]
 * @param {string} [options.nodeExecutable]
 * @param {string} [options.cwd]
 * @param {OpenCliFileSystem} [options.fs]
 * @returns {OpenCliLaunchTarget}
 */
export function resolveOpenCliLaunchTarget(options = {}) {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const nodeExecutable = options.nodeExecutable ?? process.execPath;
  const cwd = options.cwd ?? process.cwd();
  const fs = options.fs ?? defaultFileSystem();
  const configured = unquote(envValue(env, "PI_WEB_OPENCLI_BIN") || "");

  if (platform !== "win32") {
    if (configured && SCRIPT_EXTENSIONS.has(extension(configured, posix))) {
      return { command: nodeExecutable, prefixArgs: [configured], source: "override", displayName: "Node.js · OpenCLI" };
    }
    return {
      command: configured || "opencli",
      prefixArgs: [],
      source: configured ? "override" : "system-path",
      displayName: "OpenCLI",
    };
  }

  let unresolvedShim = false;
  if (configured) {
    const hasDirectory = configured.includes("\\") || configured.includes("/");
    if (hasDirectory) {
      const configuredPath = win32.isAbsolute(configured) ? configured : win32.resolve(cwd, configured);
      const target = windowsTarget(configuredPath, "override", nodeExecutable, fs);
      if (target) return target;
      if (WINDOWS_SHIM_EXTENSIONS.has(extension(configuredPath, win32)) && fs.exists(configuredPath)) {
        throw new OpenCliResolutionError("opencli_windows_shim_unresolved", "OpenCLI npm shim was found but its package entry could not be resolved");
      }
      throw new OpenCliResolutionError("opencli_not_found", "Configured OpenCLI executable was not found");
    }
  }

  const pathDirectories = (envValue(env, "PATH") || "")
    .split(win32.delimiter)
    .map(unquote)
    .filter(Boolean);
  const fallbackDirectories = [
    envValue(env, "APPDATA") ? win32.join(envValue(env, "APPDATA"), "npm") : "",
    envValue(env, "NPM_CONFIG_PREFIX") || "",
  ].filter(Boolean);
  const directories = Array.from(new Set([...pathDirectories, ...fallbackDirectories]));
  const requestedName = configured || "opencli";

  for (const directory of directories) {
    const candidates = configured
      ? [
          win32.join(directory, requestedName),
          ...(!extension(requestedName, win32)
            ? [".exe", ".com", ".cmd", ".bat"].map((ext) => win32.join(directory, `${requestedName}${ext}`))
            : []),
        ].filter((candidate) => fs.exists(candidate))
      : windowsCandidates(directory, fs);
    for (const candidate of candidates) {
      const target = windowsTarget(candidate, configured ? "override" : "path-native", nodeExecutable, fs);
      if (target) return target;
      if (WINDOWS_SHIM_EXTENSIONS.has(extension(candidate, win32))) unresolvedShim = true;
    }
  }

  if (!configured) {
    for (const directory of fallbackDirectories) {
      const entry = resolvePackageEntry(directory, win32, fs);
      if (entry) {
        return {
          command: nodeExecutable,
          prefixArgs: [entry],
          source: "npm-entry",
          displayName: "Node.js · @jackwener/opencli",
        };
      }
    }
  }

  if (unresolvedShim) {
    throw new OpenCliResolutionError("opencli_windows_shim_unresolved", "OpenCLI npm shim was found but its package entry could not be resolved");
  }
  throw new OpenCliResolutionError("opencli_not_found", "OpenCLI executable was not found");
}
