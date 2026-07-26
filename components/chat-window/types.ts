import type { RefObject } from "react";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ChatInputHandle, ComposerActivity } from "../ChatInput";

export interface SessionStats {
  tokens: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  cost?: number;
}

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface ChatWindowProps {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsChange?: (stats: SessionStats | null) => void;
  onContextUsageChange?: (usage: ContextUsage | null) => void;
  onTaskStatusChange?: (status: "done" | "running" | "error", message?: string | null) => void;
  onComposerActivityChange?: (activity: ComposerActivity) => void;
}

export interface ExtensionWidget {
  key: string;
  lines: string[];
  placement?: "aboveEditor" | "belowEditor";
}
