export type OpenCliBinarySource = "override" | "path-native" | "npm-entry" | "system-path";

export interface OpenCliLaunchTarget {
  command: string;
  prefixArgs: string[];
  source: OpenCliBinarySource;
  displayName: string;
}

export interface OpenCliFileSystem {
  exists(path: string): boolean;
  readText(path: string): string;
  realpath(path: string): string;
}

export class OpenCliResolutionError extends Error {
  code: "opencli_not_found" | "opencli_windows_shim_unresolved";
  constructor(code: "opencli_not_found" | "opencli_windows_shim_unresolved", message: string);
}

export function resolveOpenCliLaunchTarget(options?: {
  platform?: NodeJS.Platform;
  env?: Record<string, string | undefined>;
  nodeExecutable?: string;
  cwd?: string;
  fs?: OpenCliFileSystem;
}): OpenCliLaunchTarget;
