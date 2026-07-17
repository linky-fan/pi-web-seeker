import fs from "fs";
import path from "path";
import { homedir } from "os";
import { getSessionCwdRoots } from "./session-reader";
import { getRegisteredWorkspaceRoots } from "./workspace-roots";

declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
}

const ALLOWED_ROOTS_TTL_MS = 5_000;
const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

export function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/");
}

function addConfiguredRoots(roots: Set<string>): void {
  const envRoots = process.env.PI_WEB_ALLOWED_ROOTS;
  if (envRoots) {
    for (const root of envRoots.split(path.delimiter)) {
      const trimmed = root.trim();
      if (trimmed) roots.add(trimmed);
    }
  }
  const defaultCwd = process.env.PI_WEB_DEFAULT_CWD?.trim();
  if (defaultCwd) roots.add(defaultCwd);
}

export async function getAllowedRoots(): Promise<Set<string>> {
  const now = Date.now();
  const cached = globalThis.__piAllowedRootsCache;
  if (cached && cached.expiresAt > now) return cached.roots;

  const roots = new Set<string>();
  addConfiguredRoots(roots);

  if (process.env.PI_WEB_SINGLE_WORKSPACE === "1" && roots.size > 0) {
    globalThis.__piAllowedRootsCache = { roots, expiresAt: now + ALLOWED_ROOTS_TTL_MS };
    return roots;
  }

  for (const cwd of await getSessionCwdRoots()) {
    if (cwd) roots.add(cwd);
  }

  for (const cwd of getRegisteredWorkspaceRoots()) {
    if (cwd) roots.add(cwd);
  }

  try {
    for (const name of fs.readdirSync(homedir())) {
      if (/^pi-cwd-\d{8}$/.test(name)) {
        roots.add(path.join(homedir(), name));
      }
    }
  } catch {
    // ignore if home is unreadable
  }

  globalThis.__piAllowedRootsCache = { roots, expiresAt: now + ALLOWED_ROOTS_TTL_MS };
  return roots;
}

function realpathIfExists(filePath: string): string | null {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return null;
  }
}

function normalizeForComparison(filePath: string, useWindowsRules: boolean): string {
  const resolver = useWindowsRules ? path.win32 : path;
  const resolved = resolver.resolve(filePath);
  return useWindowsRules ? normalizeSlashes(resolved).toLowerCase() : resolved;
}

export function isPathAllowed(target: string, allowedRoots: Set<string>): boolean {
  const targetRealPath = realpathIfExists(target);
  const targetCandidates = targetRealPath ? [targetRealPath] : [target];

  for (const root of allowedRoots) {
    const rootRealPath = realpathIfExists(root);
    const rootCandidates = rootRealPath ? [rootRealPath] : [root];

    for (const targetCandidate of targetCandidates) {
      for (const rootCandidate of rootCandidates) {
        const useWindowsRules = isWindowsAbsolutePath(targetCandidate) || isWindowsAbsolutePath(rootCandidate);
        const sep = useWindowsRules ? "/" : path.sep;
        const comparable = normalizeForComparison(targetCandidate, useWindowsRules);
        const comparableRoot = normalizeForComparison(rootCandidate, useWindowsRules);
        const rootWithSep = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep;
        if (comparable === comparableRoot || comparable.startsWith(rootWithSep)) {
          return true;
        }
      }
    }
  }
  return false;
}

export async function assertPathAllowed(target: string): Promise<void> {
  const allowedRoots = await getAllowedRoots();
  if (!isPathAllowed(target, allowedRoots)) {
    throw new Error("Access denied");
  }
}
