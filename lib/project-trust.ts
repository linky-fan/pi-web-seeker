import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  getAgentDir,
  hasTrustRequiringProjectResources,
  ProjectTrustStore,
  SettingsManager,
  type DefaultResourceLoader,
} from "@earendil-works/pi-coding-agent";

export type ProjectTrustState = "trusted" | "untrusted" | "unresolved";

export const PROJECT_TRUST_REQUIRED = "PROJECT_TRUST_REQUIRED";

export class ProjectTrustRequiredError extends Error {
  readonly code = PROJECT_TRUST_REQUIRED;
  readonly cwd: string;

  constructor(cwd: string) {
    super(`Explicit project trust is required for this workspace: ${cwd}`);
    this.name = "ProjectTrustRequiredError";
    this.cwd = cwd;
  }
}

export class ProjectTrustDeniedError extends Error {
  readonly code = "PROJECT_TRUST_DENIED";
  readonly cwd: string;

  constructor(cwd: string) {
    super(`Project trust was denied for this workspace until the server restarts: ${cwd}`);
    this.name = "ProjectTrustDeniedError";
    this.cwd = cwd;
  }
}

declare global {
  // Session-only decisions last until the server process restarts. Allow decisions
  // are persisted in the pi trust store, so this map normally only holds denies.
  var __piWebSessionTrust: Map<string, boolean> | undefined;
}

function sessionTrust(): Map<string, boolean> {
  if (!globalThis.__piWebSessionTrust) globalThis.__piWebSessionTrust = new Map();
  return globalThis.__piWebSessionTrust;
}

export function canonicalWorkspacePath(cwd: string): string {
  try {
    return realpathSync.native(cwd);
  } catch {
    return resolve(cwd);
  }
}

/** True when the workspace has project resources that Project Trust must gate. */
export function requiresProjectTrust(cwd: string): boolean {
  return hasTrustRequiringProjectResources(cwd);
}

function sessionTrustEntry(cwd: string): { path: string; decision: boolean } | undefined {
  const store = sessionTrust();
  let current = canonicalWorkspacePath(cwd);
  while (true) {
    const decision = store.get(current);
    if (decision !== undefined) return { path: current, decision };
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export interface ResolvedProjectTrust {
  decision: boolean | undefined;
  source: "session" | "persistent" | null;
  path: string | null;
}

/**
 * Nearest decision wins. Session and persisted entries are compared by path
 * specificity, and an exact-path tie uses the session decision so an in-app deny
 * cannot be overridden by an older persisted allow.
 */
export function resolveProjectTrust(cwd: string): ResolvedProjectTrust {
  const session = sessionTrustEntry(cwd);
  const persistent = new ProjectTrustStore(getAgentDir()).getEntry(cwd);

  if (!session) {
    return persistent
      ? { decision: persistent.decision, source: "persistent", path: persistent.path }
      : { decision: undefined, source: null, path: null };
  }
  if (!persistent) return { decision: session.decision, source: "session", path: session.path };

  const sessionPath = canonicalWorkspacePath(session.path);
  const persistentPath = canonicalWorkspacePath(persistent.path);
  if (sessionPath !== persistentPath && persistentPath.length > sessionPath.length) {
    return { decision: persistent.decision, source: "persistent", path: persistent.path };
  }
  return { decision: session.decision, source: "session", path: session.path };
}

export function projectTrustState(cwd: string): ProjectTrustState {
  if (!requiresProjectTrust(cwd)) return "trusted";
  const resolved = resolveProjectTrust(cwd);
  if (resolved.decision === undefined) return "unresolved";
  return resolved.decision ? "trusted" : "untrusted";
}

/** Gate for resource loaders: unresolved workspaces load no project resources. */
export function isProjectTrustedForLoad(cwd: string): boolean {
  return projectTrustState(cwd) === "trusted";
}

/** SettingsManager that hides project settings unless the workspace is trusted. */
export function createTrustAwareSettingsManager(cwd: string, agentDir: string): SettingsManager {
  return SettingsManager.create(cwd, agentDir, { projectTrusted: isProjectTrustedForLoad(cwd) });
}

/** Allow is remembered per workspace; deny only lasts until the server restarts. */
export function recordProjectTrust(cwd: string, trusted: boolean): ProjectTrustState {
  const key = canonicalWorkspacePath(cwd);
  if (trusted) {
    new ProjectTrustStore(getAgentDir()).set(cwd, true);
    sessionTrust().delete(key);
  } else {
    sessionTrust().set(key, false);
  }
  return projectTrustState(cwd);
}

export type ProjectTrustHttpError = {
  status: 403 | 428;
  body: { error: string; code: string; cwd: string };
};

export function projectTrustErrorResponse(error: unknown): ProjectTrustHttpError | null {
  if (error instanceof ProjectTrustDeniedError) {
    return { status: 403, body: { error: error.message, code: error.code, cwd: error.cwd } };
  }
  if (error instanceof ProjectTrustRequiredError) {
    return { status: 428, body: { error: error.message, code: error.code, cwd: error.cwd } };
  }
  return null;
}

/** True only for an explicit effective allow, even before project resources exist. */
export function hasExplicitProjectTrustAllow(cwd: string): boolean {
  return resolveProjectTrust(cwd).decision === true;
}

/**
 * Same nearest-path resolver as projectTrustState, but distinguishes an explicit
 * persistent/session deny (403) from an explicit allow (ok) and from no decision (428).
 */
export function assertProjectTrustedForPackageEnable(cwd: string): void {
  const resolved = resolveProjectTrust(cwd);
  if (resolved.decision === true) return;
  if (resolved.decision === false && resolved.source === "session") throw new ProjectTrustDeniedError(cwd);
  throw new ProjectTrustRequiredError(cwd);
}

export function forgetSessionProjectTrust(cwd?: string): void {
  if (cwd === undefined) sessionTrust().clear();
  else sessionTrust().delete(canonicalWorkspacePath(cwd));
}

/** Reload a resource loader with the workspace trust decision applied. */
export async function reloadResourceLoaderWithTrust(
  loader: DefaultResourceLoader,
  cwd: string,
): Promise<void> {
  await loader.reload({ resolveProjectTrust: async () => isProjectTrustedForLoad(cwd) });
}

/**
 * Applies the current trust decision to a live session's settings manager before a
 * reload. pi's reload keeps the previous flag, so denying trust mid-session would
 * otherwise keep project resources loaded.
 */
export function applyProjectTrustToSettings(
  settingsManager: Pick<SettingsManager, "setProjectTrusted">,
  cwd: string,
): ProjectTrustState {
  const state = projectTrustState(cwd);
  if (state === "unresolved") throw new ProjectTrustRequiredError(cwd);
  settingsManager.setProjectTrusted(state === "trusted");
  return state;
}