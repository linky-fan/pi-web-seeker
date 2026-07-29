import { modelRefsEqual, type BuddyMode, type ModelRef, type PlanExecutionMode, type PlanMode, type PlanModeStatus } from "@/lib/plan-mode";
import type { ContextUsage, MentionQuery, ModelGroup, ModelOption, ThinkingLevel, Translate } from "./types";

export const THINKING_LEVELS: readonly ThinkingLevel[] = ["auto", "off", "minimal", "low", "medium", "high", "xhigh", "max"];
export const HISTORY_LIMIT = 50;
export const DRAFT_STORAGE_KEY = "pi-web.chat.draft";

export const PROMPT_SNIPPETS = [
  { labelKey: "snippets.review", text: "Review the current changes and call out bugs, risks, and missing tests." },
  { labelKey: "snippets.explain", text: "Explain how this part of the code works and where the important entry points are." },
  { labelKey: "snippets.tests", text: "Add focused tests for this behavior and run the relevant checks." },
  { labelKey: "snippets.refactor", text: "Refactor this with the smallest safe change while preserving behavior." },
  { labelKey: "snippets.summarize", text: "Summarize what changed, what was verified, and any remaining risks." },
] as const;

export type WorkflowCommandDisabledReason = "reviewer-required" | "same-model" | "subagents-unavailable" | null;

export interface WorkflowSlashCommandOption {
  name: string;
  label: string;
  description: string;
  mode: PlanMode;
  executionMode: PlanExecutionMode;
  buddyMode: BuddyMode;
  active: boolean;
  disabled: boolean;
  disabledReason: WorkflowCommandDisabledReason;
}

interface WorkflowSlashCommandOptions {
  planMode: PlanMode;
  planExecutionMode: PlanExecutionMode;
  planModeStatus?: PlanModeStatus | null;
  buddyMode: BuddyMode;
  buddyReviewerModel?: ModelRef | null;
  mainModel?: ModelRef | null;
  query?: string;
  t: Translate;
}

export function getBuddyCommandDisabledReason(
  mainModel: ModelRef | null | undefined,
  reviewerModel: ModelRef | null | undefined,
  planModeStatus: PlanModeStatus | null | undefined,
): WorkflowCommandDisabledReason {
  if (!reviewerModel) return "reviewer-required";
  if (modelRefsEqual(mainModel, reviewerModel)) return "same-model";
  if (planModeStatus && !planModeStatus.subagentsAvailable) return "subagents-unavailable";
  return null;
}

export interface BuddyReviewerControlPresentation {
  title: string;
  label: string;
  hint: string;
}

export function shouldShowBuddyReviewerControl(modelOptionCount: number, canChangeReviewer: boolean): boolean {
  return modelOptionCount > 1 && canChangeReviewer;
}

export function getBuddyReviewerControlPresentation(
  buddyMode: BuddyMode,
  reviewerName: string | null | undefined,
  t: Translate,
): BuddyReviewerControlPresentation {
  if (buddyMode === "off") {
    return {
      title: t("chat.buddyConfigure"),
      label: t("chat.buddyConfigure"),
      hint: t("chat.buddyConfigureHint"),
    };
  }
  return {
    title: t("chat.buddyReviewer"),
    label: reviewerName ? `${t("chat.buddyReviewer")} · ${reviewerName}` : t("chat.buddyReviewerSelect"),
    hint: t("chat.buddyReviewerHint"),
  };
}

export function buildWorkflowSlashCommands(options: WorkflowSlashCommandOptions): WorkflowSlashCommandOption[] {
  const {
    planMode, planExecutionMode, planModeStatus, buddyMode, buddyReviewerModel, mainModel, query, t,
  } = options;
  const buddyDisabledReason = getBuddyCommandDisabledReason(mainModel, buddyReviewerModel, planModeStatus);
  const commands: WorkflowSlashCommandOption[] = [
    {
      name: "plan", label: t("chat.slash.plan"), description: t("chat.slash.planDesc"),
      mode: "plan", executionMode: "main", buddyMode: "off",
      active: planMode === "plan" && planExecutionMode === "main" && buddyMode === "off",
      disabled: false, disabledReason: null,
    },
    {
      name: "plan-subagent", label: t("chat.slash.planSubagent"),
      description: planModeStatus && !planModeStatus.subagentsAvailable
        ? t("chat.slash.planSubagentUnavailable", { tools: planModeStatus.missingTools.join(", ") || "Agent" })
        : t("chat.slash.planSubagentDesc"),
      mode: "plan", executionMode: "subagent", buddyMode: "off",
      active: planMode === "plan" && planExecutionMode === "subagent" && buddyMode === "off",
      disabled: Boolean(planModeStatus && !planModeStatus.subagentsAvailable),
      disabledReason: planModeStatus && !planModeStatus.subagentsAvailable ? "subagents-unavailable" : null,
    },
    {
      name: "buddy-plan", label: t("chat.slash.buddyPlan"), description: t("chat.slash.buddyPlanDesc"),
      mode: "plan", executionMode: "main", buddyMode: "plan", active: buddyMode === "plan",
      disabled: buddyDisabledReason !== null, disabledReason: buddyDisabledReason,
    },
    {
      name: "buddy-code", label: t("chat.slash.buddyCode"), description: t("chat.slash.buddyCodeDesc"),
      mode: "normal", executionMode: "main", buddyMode: "code", active: buddyMode === "code",
      disabled: buddyDisabledReason !== null, disabledReason: buddyDisabledReason,
    },
    {
      name: "normal", label: t("chat.slash.normal"), description: t("chat.slash.normalDesc"),
      mode: "normal", executionMode: "main", buddyMode: "off",
      active: planMode === "normal" && buddyMode === "off", disabled: false, disabledReason: null,
    },
  ];
  return commands.filter((command) => !query || command.name.startsWith(query));
}

export function mergeHistory(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const group of groups) {
    for (const item of group) {
      const trimmed = item.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      result.push(trimmed);
      if (result.length >= HISTORY_LIMIT) return result;
    }
  }
  return result;
}

export function getDraftStorageKey(scope?: string): string {
  return scope ? `${DRAFT_STORAGE_KEY}:${scope}` : DRAFT_STORAGE_KEY;
}

export interface HistoryNavigationState {
  index: number | null;
  value: string;
  draftBeforeHistory: string;
}

export function navigateHistory(
  history: string[],
  currentIndex: number | null,
  draftBeforeHistory: string,
  currentValue: string,
  key: "ArrowUp" | "ArrowDown",
  atStart: boolean,
  atEnd: boolean,
): HistoryNavigationState | null {
  const browsing = currentIndex !== null;
  if (history.length === 0 || (!browsing && !(key === "ArrowUp" && atStart) && !(key === "ArrowDown" && atEnd))) return null;
  const preservedDraft = currentIndex === null ? currentValue : draftBeforeHistory;
  if (key === "ArrowUp") {
    const index = currentIndex === null ? 0 : Math.min(currentIndex + 1, history.length - 1);
    return { index, value: history[index], draftBeforeHistory: preservedDraft };
  }
  const index = currentIndex === null ? null : currentIndex - 1;
  return index === null || index < 0
    ? { index: null, value: preservedDraft, draftBeforeHistory: preservedDraft }
    : { index, value: history[index], draftBeforeHistory: preservedDraft };
}

export function isLikelyFilePath(text: string): boolean {
  const value = text.trim();
  if (!value || value.includes("\n") || value.startsWith("`") || /^https?:\/\//i.test(value)) return false;
  if (/^([~.]?\/|\/|[a-zA-Z]:[\\/]|\\\\)/.test(value)) return true;
  return /^[\w .@+-]+[\\/][\w .@+\-/\\]+\.[A-Za-z0-9]{1,12}$/.test(value);
}

export function getMentionQuery(text: string, cursor: number): MentionQuery | null {
  const beforeCursor = text.slice(0, cursor);
  const at = beforeCursor.lastIndexOf("@");
  if (at < 0) return null;
  const prefixChar = at > 0 ? beforeCursor[at - 1] : "";
  if (prefixChar && !/\s/.test(prefixChar)) return null;
  const query = beforeCursor.slice(at + 1);
  if (/[\s`]/.test(query)) return null;
  return { start: at, end: cursor, query };
}

export function buildModelGroups(
  modelList: { id: string; name: string; provider: string }[] | undefined,
  modelNames: Record<string, string> | undefined,
  fallbackProvider: string,
): { options: ModelOption[]; groups: ModelGroup[] } {
  const options = modelList?.length
    ? modelList.map((item) => ({ provider: item.provider, modelId: item.id, name: item.name }))
    : Object.entries(modelNames ?? {}).map(([modelId, name]) => ({ provider: fallbackProvider, modelId, name }));
  const groups: ModelGroup[] = [];
  for (const option of options) {
    const group = groups.find((item) => item.provider === option.provider);
    if (group) group.options.push(option);
    else groups.push({ provider: option.provider, options: [option] });
  }
  return { options, groups };
}

export function visibleThinkingLevels(available: string[] | null | undefined): ThinkingLevel[] {
  return THINKING_LEVELS.filter((level) => {
    if (level === "auto") return true;
    if (level === "max") return available?.includes("max") ?? false;
    return available ? available.includes(level) : true;
  });
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

export function getModelContextProfile(model: { modelId: string } | null | undefined): "deepseek-v4" | "standard-512k" {
  const modelId = model?.modelId.toLowerCase() ?? "";
  return modelId.includes("deepseek") && modelId.includes("v4") ? "deepseek-v4" : "standard-512k";
}

export function getContextTone(contextUsage: ContextUsage | null | undefined, model: { modelId: string } | null | undefined): { color: string; bg: string; border: string } {
  const percent = contextUsage?.percent;
  const tokens = contextUsage?.tokens;
  if (getModelContextProfile(model) === "deepseek-v4" && tokens != null) {
    if (tokens >= 980_000) return { color: "#ef4444", bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.34)" };
    if (tokens >= 900_000) return { color: "rgba(234,179,8,0.98)", bg: "rgba(234,179,8,0.12)", border: "rgba(234,179,8,0.34)" };
    return { color: "#16a34a", bg: "rgba(22,163,74,0.08)", border: "rgba(22,163,74,0.24)" };
  }
  if (tokens != null) {
    if (tokens >= 512_000) return { color: "#ef4444", bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.34)" };
    if (tokens >= 450_000) return { color: "rgba(234,179,8,0.98)", bg: "rgba(234,179,8,0.12)", border: "rgba(234,179,8,0.34)" };
    return { color: "#16a34a", bg: "rgba(22,163,74,0.08)", border: "rgba(22,163,74,0.22)" };
  }
  if (percent != null && percent >= 95) return { color: "#ef4444", bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.28)" };
  if (percent != null && percent >= 80) return { color: "rgba(234,179,8,0.98)", bg: "rgba(234,179,8,0.10)", border: "rgba(234,179,8,0.28)" };
  if (percent != null && percent >= 60) return { color: "var(--accent)", bg: "rgba(37,99,235,0.09)", border: "rgba(37,99,235,0.22)" };
  if (percent != null) return { color: "#16a34a", bg: "rgba(22,163,74,0.08)", border: "rgba(22,163,74,0.22)" };
  return { color: "var(--text-muted)", bg: "var(--bg-panel)", border: "var(--border)" };
}

export function getContextUsageTitle(
  contextUsage: ContextUsage | null | undefined,
  isCompacting: boolean | undefined,
  model: { modelId: string } | null | undefined,
  t: Translate,
): string {
  const action = isCompacting ? t("chat.stopCompactAction") : t("chat.compactAction");
  if (!contextUsage?.contextWindow) return `${action}\n${t("chat.contextUnavailable")}`;
  const percent = contextUsage.percent !== null ? `${contextUsage.percent.toFixed(1)}%` : t("stats.unknown");
  const tokens = contextUsage.tokens !== null ? `${formatTokenCount(contextUsage.tokens)} (${contextUsage.tokens.toLocaleString()})` : t("stats.unknown");
  const windowSize = `${formatTokenCount(contextUsage.contextWindow)} (${contextUsage.contextWindow.toLocaleString()})`;
  const hint = getModelContextProfile(model) === "deepseek-v4" ? t("chat.contextHint.deepseekV4") : t("chat.contextHint.standard512k");
  return `${action}\n${t("stats.context")}: ${percent}\n${t("chat.contextTokens")}: ${tokens} / ${windowSize}\n${hint}`;
}
