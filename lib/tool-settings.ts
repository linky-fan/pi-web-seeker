import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_TOOL_NAMES } from "./plan-mode";

export const BUILTIN_CODING_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];
export const DEFAULT_ACTIVE_TOOL_NAMES = ["read", "bash", "edit", "write"];
export const BUILTIN_CODING_TOOL_SET = new Set(BUILTIN_CODING_TOOL_NAMES);
export const SUBAGENT_TOOL_SET = new Set<string>(SUBAGENT_TOOL_NAMES);

const SETTINGS_FILE = "settings.json";
const ACTIVE_TOOLS_KEY = "activeTools";

export function uniqueToolNames(names: string[]): string[] {
  return Array.from(new Set(names));
}

export function getDefaultActiveToolNames(extensionToolNames: string[]): string[] {
  return uniqueToolNames([
    ...DEFAULT_ACTIVE_TOOL_NAMES,
    ...extensionToolNames.filter((name) => !SUBAGENT_TOOL_SET.has(name)),
  ]);
}

export function includeDefaultExtensionTools(requestedToolNames: string[], extensionToolNames: string[]): string[] {
  if (requestedToolNames.length === 0) return [];
  return uniqueToolNames([
    ...requestedToolNames,
    ...extensionToolNames.filter((name) => !SUBAGENT_TOOL_SET.has(name)),
  ]);
}

export function getLoadedExtensionToolNames(resourceLoader: DefaultResourceLoader): string[] {
  const extensions = resourceLoader.getExtensions();
  const names = new Set<string>();

  for (const extension of extensions.extensions) {
    for (const name of extension.tools.keys()) {
      if (!BUILTIN_CODING_TOOL_SET.has(name)) names.add(name);
    }
  }

  return Array.from(names).sort();
}

export function getSettingsPath(agentDir: string): string {
  return join(agentDir, SETTINGS_FILE);
}

export function readActiveTools(agentDir: string): string[] | null {
  const settingsPath = getSettingsPath(agentDir);
  if (!existsSync(settingsPath)) return null;

  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    const tools = settings[ACTIVE_TOOLS_KEY];
    return Array.isArray(tools) ? tools.filter((tool): tool is string => typeof tool === "string") : null;
  } catch {
    return null;
  }
}

export function writeActiveTools(agentDir: string, activeTools: string[]): void {
  const settingsPath = getSettingsPath(agentDir);
  let settings: Record<string, unknown> = {};

  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    } catch {
      settings = {};
    }
  }

  settings[ACTIVE_TOOLS_KEY] = uniqueToolNames(activeTools.filter((tool): tool is string => typeof tool === "string"));
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
}

export function filterKnownToolNames(toolNames: string[], allToolNames: string[]): string[] {
  const known = new Set(allToolNames);
  return uniqueToolNames(toolNames).filter((name) => known.has(name));
}
