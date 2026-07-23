import type { SessionInfo } from "@/lib/types";

export type TaskStatus = "done" | "running" | "error";
export type FluidDrawerView = "sessions" | "explorer" | "context";
export type FluidContextTab = "session" | "system";
export type FluidInspectorTier = 1 | 2;
export type FluidMetricTone = "accent" | "warning" | "danger";

export interface ShellSessionStats {
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  cost?: number;
}

export interface ShellContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface FluidMetric {
  key: string;
  label: string;
  value: string;
  tone?: FluidMetricTone;
  title?: string;
}

export interface DebugBundleSummary {
  targetCwd: string;
  sessionId: string;
  fileCount: number;
  fileBytes: number;
  mediaCount: number;
  mediaBytes: number;
  warnings?: string[];
  manifest?: {
    source?: {
      cwd?: string;
      platform?: string;
      appVersion?: string;
      piVersion?: string;
    };
    workspace?: {
      excluded?: Array<{ path: string; reason: string; size?: number }>;
    };
  };
}

export interface SessionWorkspaceSnapshot {
  selectedSession: SessionInfo | null;
  newSessionCwd: string | null;
  activeCwd: string | null;
}
