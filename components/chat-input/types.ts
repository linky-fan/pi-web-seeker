import type { BuddyMode, ModelRef, PlanExecutionMode, PlanMode, PlanModeStatus } from "@/lib/plan-mode";

export interface AttachedImage {
  data: string;
  mimeType: string;
  previewUrl: string;
}

export interface ComposerActivity {
  focused: boolean;
  hasDraft: boolean;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  addImages: (files: File[]) => void;
}

export type ThinkingLevel = "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

export interface ModelGroup {
  provider: string;
  options: ModelOption[];
}

export interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

export interface FileMentionEntry {
  name: string;
  path: string;
  isDir: boolean;
  modified: string;
}

export interface MentionQuery {
  start: number;
  end: number;
  query: string;
}

export interface ChatInputProps {
  onSend: (message: string, images?: AttachedImage[]) => boolean | Promise<boolean>;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  onModelChange?: (provider: string, modelId: string) => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  contextUsage?: ContextUsage | null;
  thinkingLevel?: ThinkingLevel;
  onThinkingLevelChange?: (level: ThinkingLevel) => void;
  planMode?: PlanMode;
  planExecutionMode?: PlanExecutionMode;
  planModeStatus?: PlanModeStatus | null;
  onPlanModeChange?: (mode: PlanMode, executionMode?: PlanExecutionMode) => boolean | Promise<boolean>;
  buddyMode?: BuddyMode;
  buddyReviewerModel?: ModelRef | null;
  onBuddyModeChange?: (mode: BuddyMode) => boolean | Promise<boolean>;
  onBuddyReviewerChange?: (provider: string, modelId: string) => boolean | Promise<boolean>;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  promptHistory?: string[];
  draftStorageKey?: string;
  cwd?: string | null;
  onActivityChange?: (activity: ComposerActivity) => void;
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;
