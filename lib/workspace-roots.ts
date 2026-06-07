declare global {
  var __piWorkspaceRoots: Set<string> | undefined;
}

export function getRegisteredWorkspaceRoots(): Set<string> {
  if (!globalThis.__piWorkspaceRoots) globalThis.__piWorkspaceRoots = new Set();
  return globalThis.__piWorkspaceRoots;
}

export function registerWorkspaceRoot(cwd: string): void {
  getRegisteredWorkspaceRoots().add(cwd);
}
