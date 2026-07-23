import { APP_NAME } from "@/lib/branding";
import type { FluidMetric, FluidMetricTone, ShellContextUsage, ShellSessionStats, TaskStatus } from "./types";

export const FLUID_TITLE_MAX_CHARS = 42;
export const FLUID_RAIL_WIDTH = 44;
export const FLUID_INSPECTOR_TIER_TWO_WIDTH = 560;
export const FLUID_INSPECTOR_TIER_TWO_MIN_WORKSPACE = 680;
export const FLUID_INSPECTOR_TIER_TWO_MIN_VIEWPORT =
  FLUID_RAIL_WIDTH + FLUID_INSPECTOR_TIER_TWO_WIDTH + FLUID_INSPECTOR_TIER_TWO_MIN_WORKSPACE;

export const TASK_STATUS_META: Record<TaskStatus, { label: string; color: string; glow: string; shadow: string }> = {
  done: { label: "Done", color: "#34d399", glow: "#10b981", shadow: "rgba(16,185,129,0.72)" },
  running: { label: "Running", color: "#7dd3fc", glow: "#38bdf8", shadow: "rgba(56,189,248,0.76)" },
  error: { label: "Error", color: "#fb7185", glow: "#f43f5e", shadow: "rgba(244,63,94,0.76)" },
};

export function statusFavicon(status: TaskStatus): string {
  const meta = TASK_STATUS_META[status];
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`,
    `<defs>`,
    `<radialGradient id="halo" cx="50%" cy="45%" r="60%">`,
    `<stop offset="0%" stop-color="${meta.glow}" stop-opacity="0.58"/>`,
    `<stop offset="58%" stop-color="${meta.glow}" stop-opacity="0.16"/>`,
    `<stop offset="100%" stop-color="${meta.glow}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `<filter id="softGlow" x="-45%" y="-45%" width="190%" height="190%">`,
    `<feDropShadow dx="0" dy="0" stdDeviation="1.7" flood-color="${meta.shadow}"/>`,
    `</filter>`,
    `</defs>`,
    `<rect x="1" y="1" width="30" height="30" rx="8" fill="#08111f"/>`,
    `<rect x="1.75" y="1.75" width="28.5" height="28.5" rx="7.25" fill="none" stroke="${meta.glow}" stroke-opacity="0.34" stroke-width="1.1"/>`,
    `<circle cx="16" cy="16" r="15" fill="url(#halo)"/>`,
    `<text x="16" y="22.3" text-anchor="middle" font-size="22" font-family="Georgia, 'Times New Roman', serif" font-weight="700" fill="${meta.color}" filter="url(#softGlow)">π</text>`,
    status === "running"
      ? `<circle cx="25" cy="7.4" r="3.2" fill="${meta.glow}" filter="url(#softGlow)"/><circle cx="25" cy="7.4" r="1.3" fill="#ecfeff"/>`
      : "",
    status === "error"
      ? `<circle cx="25" cy="7.4" r="3.2" fill="${meta.glow}" filter="url(#softGlow)"/><path d="M25 5.6v2.2" stroke="#fff1f2" stroke-width="1.2" stroke-linecap="round"/><circle cx="25" cy="9.3" r="0.55" fill="#fff1f2"/>`
      : "",
    `</svg>`,
  ].join("");
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function updateBrowserTaskStatus(status: TaskStatus): void {
  if (typeof document === "undefined") return;
  const meta = TASK_STATUS_META[status];
  document.title = `${APP_NAME} - ${meta.label}`;
  let link = document.querySelector<HTMLLinkElement>('link[data-pi-task-status-icon="true"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.dataset.piTaskStatusIcon = "true";
    document.head.appendChild(link);
  }
  link.href = statusFavicon(status);
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function normalizeHeaderText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function truncateFluidTitle(value: string): string {
  const normalized = normalizeHeaderText(value);
  if (normalized.length <= FLUID_TITLE_MAX_CHARS) return normalized;
  return `${normalized.slice(0, FLUID_TITLE_MAX_CHARS - 3).trimEnd()}...`;
}

export function workspaceLabelFromCwd(cwd: string | null | undefined): string {
  if (!cwd) return APP_NAME;
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const label = normalized.split("/").filter(Boolean).pop();
  return label || normalized || APP_NAME;
}

export function isDebugBundleFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".tar.gz") || name.endsWith(".tgz");
}

export function normalizeExplorerMentionPath(filePath: string): { path: string; projectRelative: boolean } {
  const normalized = filePath.replace(/\\/g, "/");
  const alreadyQualified = normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.startsWith("//");

  return {
    path: alreadyQualified ? normalized : `./${normalized}`,
    projectRelative: !normalized.startsWith("/") && !/^[a-zA-Z]:\//.test(normalized) && !normalized.startsWith("//"),
  };
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}k`;
  return String(value);
}

export function buildFluidMetrics(
  sessionStats: ShellSessionStats | null,
  contextUsage: ShellContextUsage | null,
  labels: { input: string; output: string; cacheRead: string; cacheWrite: string; cost: string; context: string; unknown: string },
): { metrics: FluidMetric[]; tooltip?: string } {
  const tokens = sessionStats?.tokens ?? null;
  const costText = sessionStats?.cost
    ? sessionStats.cost >= 0.01 ? `$${sessionStats.cost.toFixed(2)}` : "<$0.01"
    : null;
  const contextValue = contextUsage?.contextWindow
    ? `${contextUsage.percent !== null ? `${contextUsage.percent.toFixed(0)}%` : "?"} / ${formatCompactNumber(contextUsage.contextWindow)}`
    : null;
  const contextTone: FluidMetricTone | undefined = contextUsage?.percent !== null && contextUsage?.percent !== undefined
    ? contextUsage.percent > 90 ? "danger" : contextUsage.percent > 70 ? "warning" : undefined
    : undefined;
  const tooltipParts: string[] = [];
  if (tokens) {
    tooltipParts.push(`${labels.input}: ${tokens.input.toLocaleString()}`);
    tooltipParts.push(`${labels.output}: ${tokens.output.toLocaleString()}`);
    tooltipParts.push(`${labels.cacheRead}: ${tokens.cacheRead.toLocaleString()}`);
    tooltipParts.push(`${labels.cacheWrite}: ${tokens.cacheWrite.toLocaleString()}`);
  }
  if (sessionStats?.cost) tooltipParts.push(`${labels.cost}: $${sessionStats.cost.toFixed(4)}`);
  if (contextUsage?.contextWindow) {
    tooltipParts.push(`${labels.context}: ${contextUsage.percent !== null ? `${contextUsage.percent.toFixed(1)}%` : labels.unknown} / ${contextUsage.contextWindow.toLocaleString()}`);
  }

  const items: Array<FluidMetric | null> = [
    tokens && tokens.input > 0 ? { key: "input", label: "IN", value: formatCompactNumber(tokens.input), title: `${labels.input}: ${tokens.input.toLocaleString()}` } : null,
    tokens && tokens.output > 0 ? { key: "output", label: "OUT", value: formatCompactNumber(tokens.output), title: `${labels.output}: ${tokens.output.toLocaleString()}` } : null,
    tokens && tokens.cacheRead > 0 ? { key: "cache", label: "CACHE", value: formatCompactNumber(tokens.cacheRead), tone: "accent", title: `${labels.cacheRead}: ${tokens.cacheRead.toLocaleString()}` } : null,
    costText ? { key: "cost", label: "COST", value: costText, title: `${labels.cost}: ${sessionStats?.cost?.toFixed(4) ?? costText}` } : null,
    contextValue ? {
      key: "context",
      label: "CTX",
      value: contextValue,
      tone: contextTone,
      title: contextUsage?.contextWindow
        ? `${labels.context}: ${contextUsage.percent !== null ? `${contextUsage.percent.toFixed(1)}%` : labels.unknown} / ${contextUsage.contextWindow.toLocaleString()}`
        : undefined,
    } : null,
  ];

  return {
    metrics: items.filter((item): item is FluidMetric => Boolean(item)),
    tooltip: tooltipParts.length > 0 ? tooltipParts.join("  |  ") : undefined,
  };
}
