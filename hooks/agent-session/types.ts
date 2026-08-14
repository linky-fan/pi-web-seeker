import type { RefObject } from "react";
import type {
  AgentMessage,
  ExtensionUiRequest,
  SessionInfo,
  SessionTreeNode,
} from "@/lib/types";
import type { BuddyMode, ModelRef, PlanExecutionMode, PlanModeStatus } from "@/lib/plan-mode";
import type { AttachedImage, ChatInputHandle } from "@/components/chat-input/types";

export interface SessionData {
  sessionId: string;
  filePath: string;
  tree: SessionTreeNode[];
  leafId: string | null;
  context: {
    messages: AgentMessage[];
    entryIds: string[];
    thinkingLevel: string;
    model: { provider: string; modelId: string } | null;
  };
}

export interface StreamingState {
  isStreaming: boolean;
  streamingMessage: Partial<AgentMessage> | null;
}

export type StreamAction =
  | { type: "start" }
  | { type: "update"; message: Partial<AgentMessage> }
  | { type: "runtime_error" }
  | { type: "end" }
  | { type: "reset" };

export interface AgentEvent {
  type: string;
  [key: string]: unknown;
}

export type LiveAgentState = {
  isStreaming?: boolean;
  isCompacting?: boolean;
  contextUsage?: { percent: number | null; contextWindow: number; tokens: number | null } | null;
  systemPrompt?: string;
  thinkingLevel?: string;
  planMode?: boolean;
  planExecutionMode?: PlanExecutionMode;
  planModeStatus?: PlanModeStatus;
  buddyMode?: BuddyMode;
  buddyReviewerModel?: ModelRef | null;
};

export type AgentStateResponse = { running: boolean; state?: LiveAgentState };
export type ExtensionUiDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;
export type ExtensionUiCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;

export type NoticeType = "info" | "success" | "warning" | "error";
export type NoticeItem = { id: string; message: string; type: NoticeType };
export type NoticeState = { visible: NoticeItem[] };
export type NoticeAction =
  | { type: "add"; notice: NoticeItem }
  | { type: "dismiss"; id: string }
  | { type: "reset" };

export type AgentPhase =
  | { kind: "waiting_model" }
  | { kind: "running_tools"; tools: { id: string; name: string }[] }
  | null;

export type ThinkingLevelOption = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface UseAgentSessionOptions {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  setNewSessionModel?: (model: { provider: string; modelId: string } | null) => void;
}

export interface ModelListItem {
  id: string;
  name: string;
  provider: string;
}

export interface SessionStats {
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cost: number;
}

export type { AttachedImage, ChatInputHandle };
