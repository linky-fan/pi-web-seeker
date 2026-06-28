"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { AgentMessage, AssistantMessage, CustomMessage, SessionInfo, SessionTreeNode, TextContent, ToolCallContent } from "@/lib/types";
import { MessageView, type ComsNetResponseHint } from "./MessageView";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { ChatMinimap, useMessageRefs } from "./ChatMinimap";
import { useAgentSession, type AgentPhase } from "@/hooks/useAgentSession";
import { useAudio } from "@/hooks/useAudio";
import { useDragDrop } from "@/hooks/useDragDrop";
import { BrandTypewriterHeader } from "./BrandTypewriter";
import { useLocale } from "@/lib/i18n";
import { useUiMode } from "@/hooks/useUiMode";
import { apiPath } from "@/lib/api-path";

interface Props {
  session: SessionInfo | null;
  newSessionCwd: string | null;
  onAgentEnd?: () => void;
  onSessionCreated?: (session: SessionInfo) => void;
  onSessionForked?: (newSessionId: string) => void;
  modelsRefreshKey?: number;
  chatInputRef?: React.RefObject<ChatInputHandle | null>;
  onBranchDataChange?: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange?: (prompt: string | null) => void;
  onSessionStatsChange?: (stats: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost?: number } | null) => void;
  onContextUsageChange?: (usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => void;
  onTaskStatusChange?: (status: "done" | "running" | "error", message?: string | null) => void;
}

const LAZY_RECENT_MESSAGE_COUNT = 24;
const LAZY_MESSAGE_THRESHOLD = 60;
const LAZY_ROOT_MARGIN_PX = 1600;

function phaseLabel(phase: AgentPhase): string {
  if (phase?.kind === "running_tools") {
    const names = phase.tools.map((t) => t.name);
    if (names.length === 0) return "Running tool...";
    if (names.length === 1) return `Running ${names[0]}...`;
    if (names.length <= 3) return `Running ${names.join(", ")}...`;
    return `Running ${names.slice(0, 2).join(", ")} (+${names.length - 2})...`;
  }
  if (phase?.kind === "waiting_model") return "Waiting for model...";
  return "Thinking...";
}

function userMessageText(message: AgentMessage): string | null {
  if (message.role !== "user") return null;
  if (typeof message.content === "string") return message.content.trim() || null;
  const text = message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  return text || null;
}

interface ComsNetInboundHint {
  peer: string;
  prompt: string;
  msgId?: string;
}

interface ComsNetResponseSentHint {
  peer: string;
  response?: string;
  msgId: string;
  index: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function normalizeComsNetText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function comsNetInboundKey(hint: ComsNetInboundHint): string {
  return `${hint.peer}\n${normalizeComsNetText(hint.prompt)}`;
}

function extractComsNetInbound(message: AgentMessage): ComsNetInboundHint | null {
  if (message.role === "custom") {
    const custom = message as CustomMessage;
    if (custom.customType !== "coms-net-inbound") return null;
    const details = isRecord(custom.details) ? custom.details : {};
    const sender = isRecord(details.sender) ? details.sender : {};
    const content = typeof custom.content === "string"
      ? custom.content
      : custom.content.filter((part): part is TextContent => part.type === "text").map((part) => part.text).join("\n");
    const prompt = stringValue(details.prompt)
      ?? content.replace(/^coms-net request from [\s\S]*?:\s*/, "").trim();
    return {
      peer: stringValue(sender.name) ?? "peer",
      prompt,
      msgId: stringValue(details.msg_id),
    };
  }

  if (message.role !== "user") return null;
  const content = userMessageText(message);
  if (!content) return null;
  const match = content.match(/^A coms-net peer named "([^"]+)" asked for help\.\n\nRequest:\n([\s\S]*?)\n\nAnswer the peer directly\./);
  if (!match) return null;
  return {
    peer: match[1],
    prompt: match[2].trim(),
  };
}

function extractComsNetResponseSent(message: AgentMessage, index: number): ComsNetResponseSentHint | null {
  if (message.role !== "custom") return null;
  const custom = message as CustomMessage;
  if (custom.customType !== "coms-net-response-sent") return null;
  const details = isRecord(custom.details) ? custom.details : {};
  const msgId = stringValue(details.msg_id);
  if (!msgId) return null;
  const target = isRecord(details.target) ? details.target : {};
  return {
    peer: stringValue(target.name) ?? stringValue(details.target) ?? "peer",
    response: stringValue(details.response),
    msgId,
    index,
  };
}

function comsNetCustomMsgId(message: AgentMessage, customType: string): string | undefined {
  if (message.role !== "custom") return undefined;
  const custom = message as CustomMessage;
  if (custom.customType !== customType) return undefined;
  const details = isRecord(custom.details) ? custom.details : {};
  return stringValue(details.msg_id);
}

function comsNetAnyCustomMsgId(message: AgentMessage): string | undefined {
  if (message.role !== "custom") return undefined;
  const custom = message as CustomMessage;
  if (!custom.customType.startsWith("coms-net-")) return undefined;
  const details = isRecord(custom.details) ? custom.details : {};
  return stringValue(details.msg_id);
}

function isComsNetResponseSent(message: AgentMessage): boolean {
  return message.role === "custom" && (message as CustomMessage).customType === "coms-net-response-sent";
}

function assistantResponseText(message: AgentMessage): string {
  if (message.role !== "assistant") return "";
  return (message as AssistantMessage).content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function assistantOnlyCallsComsNetTool(message: AgentMessage): boolean {
  if (message.role !== "assistant") return false;
  const blocks = (message as AssistantMessage).content;
  return blocks.some((part): part is ToolCallContent => part.type === "toolCall" && part.toolName.startsWith("coms_net_"));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function estimateTextHeight(text: string, base = 52): number {
  const explicitLines = text.split("\n").length;
  const wrappedLines = Math.ceil(text.length / 90);
  return base + Math.max(explicitLines, wrappedLines) * 20;
}

function estimateMessageHeight(message: AgentMessage): number {
  if (message.role === "user") {
    const content = message.content;
    if (typeof content === "string") return clampNumber(estimateTextHeight(content, 44), 54, 360);
    const text = content
      .filter((block): block is TextContent => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    const imageCount = content.filter((block) => block.type === "image").length;
    return clampNumber(estimateTextHeight(text, 44) + imageCount * 132, 76, 520);
  }

  if (message.role === "assistant") {
    const blocks = message.content ?? [];
    let textLength = 0;
    let textLines = 0;
    let extraBlocks = 0;
    for (const block of blocks) {
      if (block.type === "text") {
        const text = block.text ?? "";
        textLength += text.length;
        textLines += text.split("\n").length;
      } else {
        extraBlocks += 1;
      }
    }
    const lines = Math.max(textLines, Math.ceil(textLength / 90));
    return clampNumber(54 + lines * 22 + extraBlocks * 76, 70, 640);
  }

  if (message.role === "custom") {
    const content = typeof message.content === "string" ? message.content : "";
    return clampNumber(estimateTextHeight(content, 54), 70, 420);
  }

  return 1;
}

function LazyMessageSlot({
  children,
  eager,
  estimatedHeight,
  registerRef,
  scrollRoot,
}: {
  children: ReactNode;
  eager: boolean;
  estimatedHeight: number;
  registerRef?: (el: HTMLDivElement | null) => void;
  scrollRoot: RefObject<HTMLDivElement | null>;
}) {
  const [shouldRender, setShouldRender] = useState(eager);
  const slotRef = useRef<HTMLDivElement | null>(null);

  const setSlotRef = useCallback((el: HTMLDivElement | null) => {
    slotRef.current = el;
    registerRef?.(el);
  }, [registerRef]);

  useEffect(() => {
    if (eager) {
      setShouldRender(true);
      return;
    }
    if (shouldRender) return;

    const el = slotRef.current;
    const root = scrollRoot.current;
    if (!el || !root || typeof IntersectionObserver === "undefined") {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting || entry.intersectionRatio > 0)) {
        setShouldRender(true);
        observer.disconnect();
      }
    }, {
      root,
      rootMargin: `${LAZY_ROOT_MARGIN_PX}px 0px`,
      threshold: 0,
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [eager, scrollRoot, shouldRender]);

  const style = shouldRender
    ? ({
        contentVisibility: "auto",
        containIntrinsicSize: `${estimatedHeight}px`,
      } as CSSProperties)
    : ({
        minHeight: estimatedHeight,
        contentVisibility: "auto",
        containIntrinsicSize: `${estimatedHeight}px`,
        contain: "layout style paint",
      } as CSSProperties);

  return (
    <div ref={setSlotRef} style={style}>
      {shouldRender ? children : null}
    </div>
  );
}

interface AgentsMdReport {
  approxTokens?: number;
  warnings?: string[];
  errors?: string[];
}

interface AgentsMdProfile {
  projectName?: string;
  template?: string;
  isEmpty?: boolean;
  packageManager?: string | null;
  languages?: string[];
  frameworks?: string[];
  tools?: string[];
  evidence?: string[];
  metadataOnly?: boolean;
  commands?: Array<{ label: string; command: string; source?: string }>;
}

interface AgentsMdDraft {
  approxTokens?: number;
  template?: string;
  markdown?: string;
  warnings?: string[];
  questions?: string[];
  profile?: AgentsMdProfile;
}

interface AgentsMdStatus {
  exists: boolean;
  filePath?: string;
  result?: AgentsMdReport | null;
}

const MAX_VISIBLE_AGENTS_MD_FINDINGS = 5;

function AgentsMdHint({ cwd }: { cwd: string }) {
  const { t } = useLocale();
  const [status, setStatus] = useState<AgentsMdStatus | null>(null);
  const [busy, setBusy] = useState<"init" | "check" | "draft" | null>(null);
  const [draft, setDraft] = useState<AgentsMdDraft | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(apiPath(`agents-md?cwd=${encodeURIComponent(cwd)}`));
      const data = await res.json() as AgentsMdStatus & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load AGENTS.md status");
      setStatus({ exists: data.exists, filePath: data.filePath });
      setExpanded(!data.exists);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [cwd]);

  useEffect(() => {
    setStatus(null);
    setDraft(null);
    setMessage(null);
    setError(null);
    setExpanded(false);
    void loadStatus();
  }, [loadStatus]);

  const postAgentsAction = useCallback(async (action: "init" | "check" | "draft") => {
    const res = await fetch(apiPath("agents-md"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, action, template: action === "init" ? "auto" : undefined }),
    });
    const data = await res.json() as {
      ok?: boolean;
      exists?: boolean;
      filePath?: string;
      result?: AgentsMdReport | AgentsMdDraft | null;
      error?: string;
      stderr?: string;
    };
    if (!res.ok || data.ok === false) throw new Error(data.stderr || data.error || "AGENTS.md action failed");
    return data;
  }, [cwd]);

  const runAction = useCallback(async (action: "init" | "check" | "draft") => {
    setBusy(action);
    setMessage(null);
    setError(null);
    try {
      const data = await postAgentsAction(action);
      if (action === "init") {
        setStatus({ exists: Boolean(data.exists), filePath: data.filePath });
        setDraft(null);
        setMessage(t("agentsMd.created"));
        setExpanded(false);
      } else if (action === "draft") {
        const nextDraft = data.result as AgentsMdDraft | null;
        setStatus((prev) => ({ exists: Boolean(data.exists ?? prev?.exists), filePath: data.filePath ?? prev?.filePath }));
        setDraft(nextDraft);
        setMessage(t("agentsMd.draftReady"));
        setExpanded(true);
      } else {
        const report = data.result as AgentsMdReport | null;
        const warnings = report?.warnings?.length ?? 0;
        const errors = report?.errors?.length ?? 0;
        setStatus({ exists: Boolean(data.exists), filePath: data.filePath, result: report });
        setDraft(null);
        if (warnings === 0 && errors === 0) {
          setMessage(t("agentsMd.clean"));
          setExpanded(false);
        } else {
          setMessage(t("agentsMd.summary", {
            tokens: report?.approxTokens ?? 0,
            warnings,
            errors,
          }));
          setExpanded(true);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }, [postAgentsAction, t]);

  const report = status?.result;
  const warnings = report?.warnings?.length ?? 0;
  const errors = report?.errors?.length ?? 0;
  const draftWarnings = draft?.warnings?.length ?? 0;
  const draftQuestions = draft?.questions?.length ?? 0;
  const visibleErrors = report?.errors?.slice(0, MAX_VISIBLE_AGENTS_MD_FINDINGS) ?? [];
  const visibleWarnings = report?.warnings?.slice(0, Math.max(0, MAX_VISIBLE_AGENTS_MD_FINDINGS - visibleErrors.length)) ?? [];
  const hiddenFindings = Math.max(0, errors + warnings - visibleErrors.length - visibleWarnings.length);
  const statusText = !status
    ? t("subagents.checking")
    : status.exists
      ? t("agentsMd.ready")
      : t("agentsMd.missing");
  const summary = draft
    ? t("agentsMd.draftSummary", { tokens: draft.approxTokens ?? 0, template: draft.template ?? "auto" })
    : report
    ? t("agentsMd.summary", { tokens: report.approxTokens ?? 0, warnings, errors })
    : message;
  const hasFindings = warnings > 0 || errors > 0;
  const hasDraftDetails = Boolean(draft?.markdown || draftWarnings > 0 || draftQuestions > 0 || draft?.profile);
  const shouldShow = Boolean(error || hasFindings || draft || status);
  const tone = error || errors > 0 ? "#ef4444" : warnings > 0 || draftWarnings > 0 || draftQuestions > 0 ? "rgba(234,179,8,0.98)" : status?.exists ? "#16a34a" : "var(--text-dim)";
  const profileBits = draft?.profile ? [
    draft.profile.projectName,
    draft.profile.packageManager,
    ...(draft.profile.frameworks ?? []),
    ...(draft.profile.languages ?? []),
  ].filter(Boolean) : [];
  const evidenceBits = draft?.profile?.evidence?.slice(0, 8) ?? [];
  const actionButtonStyle = {
    height: 20,
    padding: 0,
    border: "none",
    background: "transparent",
    color: "var(--accent)",
    fontSize: 11,
    fontWeight: 650,
    cursor: busy ? "not-allowed" : "pointer",
    opacity: busy ? 0.7 : 1,
    whiteSpace: "nowrap",
  } as const;

  if (!shouldShow) return null;

  return (
    <div
      style={{
        margin: "0 52px 6px 16px",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        justifyContent: "flex-end",
      }}
    >
      <div
        title={error ?? summary ?? statusText}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          maxWidth: "100%",
          color: error ? "#ef4444" : "var(--text-dim)",
          fontSize: 11,
          lineHeight: 1,
          opacity: 0.86,
          padding: "3px 7px",
          border: "1px solid var(--border)",
          borderRadius: 999,
          background: "var(--bg-panel)",
        }}
      >
        <span style={{
          width: 5,
          height: 5,
          borderRadius: 999,
          background: tone,
          flexShrink: 0,
          opacity: 0.75,
        }} />
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          style={{
            height: 20,
            padding: 0,
            border: "none",
            background: "transparent",
            color: "var(--text-muted)",
            fontSize: 11,
            fontWeight: 650,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          AGENTS.md
        </button>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {error ?? summary ?? statusText}
        </span>
        {status && !status.exists && expanded && (
          <button
            type="button"
            onClick={() => void runAction("draft")}
            disabled={busy !== null}
            style={actionButtonStyle}
          >
            {busy === "draft" ? t("agentsMd.generating") : t("agentsMd.generate")}
          </button>
        )}
        {status?.exists && expanded && (
          <>
            <button
              type="button"
              onClick={() => void runAction("check")}
              disabled={busy !== null}
              style={actionButtonStyle}
            >
              {busy === "check" ? t("agentsMd.checking") : t("agentsMd.check")}
            </button>
            <button
              type="button"
              onClick={() => void runAction("draft")}
              disabled={busy !== null}
              style={actionButtonStyle}
            >
              {busy === "draft" ? t("agentsMd.generating") : t("agentsMd.suggest")}
            </button>
          </>
        )}
        {draft && status && !status.exists && expanded && (
          <button
            type="button"
            onClick={() => void runAction("init")}
            disabled={busy !== null}
            style={actionButtonStyle}
          >
            {busy === "init" ? t("agentsMd.writing") : t("agentsMd.write")}
          </button>
        )}
      </div>
      {expanded && (error || hasFindings || hasDraftDetails) && (
        <div
          style={{
            marginTop: 6,
            width: "min(560px, 100%)",
            padding: "8px 10px",
            border: "1px solid var(--border)",
            borderRadius: 8,
            background: "var(--bg-panel)",
            color: "var(--text-muted)",
            fontSize: 11,
            lineHeight: 1.45,
            boxShadow: "0 8px 24px -18px rgba(15,23,42,0.24)",
          }}
        >
          {error && <div style={{ color: "#ef4444" }}>{error}</div>}
          {draft?.profile && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4, color: "var(--text-muted)", fontWeight: 650 }}>{t("agentsMd.profile")}</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {profileBits.slice(0, 8).map((item) => (
                  <span key={String(item)} style={{ border: "1px solid var(--border)", borderRadius: 999, padding: "2px 6px", background: "var(--bg)", color: "var(--text-dim)" }}>
                    {item}
                  </span>
                ))}
                {draft.profile.isEmpty && (
                  <span style={{ border: "1px solid rgba(234,179,8,0.35)", borderRadius: 999, padding: "2px 6px", color: "rgba(234,179,8,0.98)" }}>
                    {t("agentsMd.emptyProject")}
                  </span>
                )}
                {draft.profile.metadataOnly && (
                  <span style={{ border: "1px solid rgba(234,179,8,0.35)", borderRadius: 999, padding: "2px 6px", color: "rgba(234,179,8,0.98)" }}>
                    {t("agentsMd.metadataOnly")}
                  </span>
                )}
              </div>
              {evidenceBits.length > 0 && (
                <div style={{ marginTop: 6, color: "var(--text-dim)" }}>
                  {t("agentsMd.evidence")}: {evidenceBits.join(", ")}
                </div>
              )}
            </div>
          )}
          {draft?.questions?.length ? (
            <div style={{ marginBottom: 8 }}>
              <div style={{ marginBottom: 4, color: "var(--text-muted)", fontWeight: 650 }}>{t("agentsMd.questions")}</div>
              {draft.questions.map((item, idx) => (
                <div key={`question:${idx}`} style={{ marginTop: 3 }}>- {item}</div>
              ))}
            </div>
          ) : null}
          {draft?.warnings?.length ? (
            <div style={{ marginBottom: 8 }}>
              {draft.warnings.map((item, idx) => (
                <div key={`draft-warning:${idx}`} style={{ marginTop: 3 }}>
                  {t("agentsMd.warningLabel")}: {item}
                </div>
              ))}
            </div>
          ) : null}
          {draft?.markdown && (
            <div>
              <div style={{ marginBottom: 4, color: "var(--text-muted)", fontWeight: 650 }}>{t("agentsMd.draft")}</div>
              <pre
                style={{
                  margin: 0,
                  maxHeight: 260,
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  background: "var(--bg)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: 9,
                  color: "var(--text-muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 10.5,
                }}
              >
                {draft.markdown}
              </pre>
            </div>
          )}
          {hasFindings && (
            <>
              <div style={{ marginBottom: 6, color: "var(--text-muted)" }}>{t("agentsMd.manualFixHint")}</div>
              {visibleErrors.map((item, idx) => (
                <div key={`error:${idx}`} style={{ color: "#ef4444", marginTop: 4 }}>
                  {t("agentsMd.errorLabel")}: {item}
                </div>
              ))}
              {visibleWarnings.map((item, idx) => (
                <div key={`warning:${idx}`} style={{ marginTop: 4 }}>
                  {t("agentsMd.warningLabel")}: {item}
                </div>
              ))}
              {hiddenFindings > 0 && (
                <div style={{ marginTop: 4, color: "var(--text-dim)" }}>
                  {t("agentsMd.moreFindings", { count: hiddenFindings })}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ChatWindow({ session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked, modelsRefreshKey, chatInputRef, onBranchDataChange, onSystemPromptChange, onSessionStatsChange, onContextUsageChange, onTaskStatusChange }: Props) {
  const { isFluid } = useUiMode();
  const {
    loading, error, messages, entryIds, streamState,
    agentRunning, modelNames, modelList, modelThinkingLevels, modelThinkingLevelMaps, thinkingLevel,
    retryInfo, contextUsage, forkingEntryId,
    isCompacting, compactError, displayModel: displayModelValue, sessionStats,
    taskError,
    agentPhase,
    toolExecutionStatuses,
    planMode,
    planExecutionMode,
    planModeStatus,
    isNew,
    messagesEndRef, scrollContainerRef,
    lastUserMsgRef,
    handleSend, handleAbort, handleFork, handleNavigate, handleModelChange,
    handleCompact, handleSteer, handleFollowUp, handleAbortCompaction,
    handleThinkingLevelChange, handlePlanModeChange, handleAgentEventRef,
  } = useAgentSession({
    session, newSessionCwd, onAgentEnd, onSessionCreated, onSessionForked,
    modelsRefreshKey, onBranchDataChange, onSystemPromptChange,
  });

  const { soundEnabled, onSoundToggle, playDoneSound } = useAudio();
  const playDoneSoundRef = useRef(playDoneSound);
  playDoneSoundRef.current = playDoneSound;
  const soundEnabledRef = useRef(soundEnabled);
  soundEnabledRef.current = soundEnabled;

  // Wrap agent event handler to play sound on agent_end
  const origHandler = handleAgentEventRef.current;
  useEffect(() => {
    handleAgentEventRef.current = (event) => {
      if (event.type === "agent_end" && soundEnabledRef.current) {
        playDoneSoundRef.current();
      }
      origHandler?.(event);
    };
  }, [origHandler, handleAgentEventRef]);

  // Push session stats up to AppShell for the top bar.
  // Compare scalar fields to avoid loops from new object identity each render.
  const statsKey = sessionStats
    ? `${sessionStats.tokens.input}|${sessionStats.tokens.output}|${sessionStats.tokens.cacheRead}|${sessionStats.tokens.cacheWrite}|${sessionStats.cost ?? 0}`
    : null;
  const sessionStatsRef = useRef(sessionStats);
  sessionStatsRef.current = sessionStats;
  useEffect(() => {
    onSessionStatsChange?.(sessionStatsRef.current);
  }, [statsKey, onSessionStatsChange]);
  useEffect(() => () => { onSessionStatsChange?.(null); }, [onSessionStatsChange]);

  // Push context usage up to AppShell as well.
  const ctxKey = contextUsage
    ? `${contextUsage.percent ?? "null"}|${contextUsage.contextWindow}|${contextUsage.tokens ?? "null"}`
    : null;
  const contextUsageRef = useRef(contextUsage);
  contextUsageRef.current = contextUsage;
  useEffect(() => {
    onContextUsageChange?.(contextUsageRef.current);
  }, [ctxKey, onContextUsageChange]);
  useEffect(() => () => { onContextUsageChange?.(null); }, [onContextUsageChange]);

  const taskStatusMessage = error ?? taskError ?? compactError ?? null;
  const taskStatus = taskStatusMessage ? "error" : agentRunning ? "running" : "done";
  useEffect(() => {
    onTaskStatusChange?.(taskStatus, taskStatusMessage);
  }, [onTaskStatusChange, taskStatus, taskStatusMessage]);
  useEffect(() => () => { onTaskStatusChange?.("done", null); }, [onTaskStatusChange]);

  const onDrop = useCallback((files: File[]) => {
    chatInputRef?.current?.addImages(files);
  }, [chatInputRef]);

  const { isDragOver, handleDragEnter, handleDragOver, handleDragLeave, handleDrop } = useDragDrop(onDrop);

  const isEmptyNew = isNew && messages.length === 0 && !streamState.isStreaming && !agentRunning;

  const availableThinkingLevels = displayModelValue
    ? (modelThinkingLevels[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const currentThinkingLevelMap = displayModelValue
    ? (modelThinkingLevelMaps[`${displayModelValue.provider}:${displayModelValue.modelId}`] ?? null)
    : null;

  const promptHistory = useMemo(() => {
    const seen = new Set<string>();
    const history: string[] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const text = userMessageText(messages[i]);
      if (!text || seen.has(text)) continue;
      seen.add(text);
      history.push(text);
      if (history.length >= 50) break;
    }
    return history;
  }, [messages]);

  const runningToolIds = useMemo(() => {
    if (agentPhase?.kind !== "running_tools") return new Set<string>();
    return new Set(agentPhase.tools.map((tool) => tool.id));
  }, [agentPhase]);

  const messageRenderData = useMemo(() => {
    const toolResultsMap = new Map<string, import("@/lib/types").ToolResultMessage>();
    const showTimestamp = new Array<boolean>(messages.length).fill(false);
    const hiddenMessageIndexes = new Set<number>();
    const comsNetResponses = new Map<number, ComsNetResponseHint>();
    const customInboundKeys = new Set<string>();
    const inboundIndexByMsgId = new Map<string, number>();
    const responseSentByMsgId = new Map<string, ComsNetResponseSentHint>();
    const responseReceivedMsgIds = new Set<string>();
    let lastUserIdx = -1;
    let seenAssistantSinceUser = false;
    let pendingInbound: (ComsNetInboundHint & { index: number; key: string }) | null = null;
    let inferredResponseIdx: number | null = null;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (msg.role === "custom") {
        const inbound = extractComsNetInbound(msg);
        if (inbound) {
          customInboundKeys.add(comsNetInboundKey(inbound));
          if (inbound.msgId) inboundIndexByMsgId.set(inbound.msgId, i);
        }
        const responseSent = extractComsNetResponseSent(msg, i);
        if (responseSent) responseSentByMsgId.set(responseSent.msgId, responseSent);
        const responseReceivedMsgId = comsNetCustomMsgId(msg, "coms-net-response-received");
        if (responseReceivedMsgId) responseReceivedMsgIds.add(responseReceivedMsgId);
      }
    }
    const loopbackMsgIds = new Set([...responseSentByMsgId.keys()].filter((msgId) => responseReceivedMsgIds.has(msgId)));

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      const anyComsNetMsgId = comsNetAnyCustomMsgId(msg);
      if (anyComsNetMsgId && loopbackMsgIds.has(anyComsNetMsgId)) {
        hiddenMessageIndexes.add(i);
      }
      if (msg.role === "user") {
        const inbound = extractComsNetInbound(msg);
        if (inbound && customInboundKeys.has(comsNetInboundKey(inbound))) {
          hiddenMessageIndexes.add(i);
        }
      }
      const responseReceivedMsgId = comsNetCustomMsgId(msg, "coms-net-response-received");
      if (responseReceivedMsgId && responseSentByMsgId.has(responseReceivedMsgId)) {
        hiddenMessageIndexes.add(i);
      }
    }

    for (const [msgId, responseSent] of responseSentByMsgId) {
      const inboundIndex = inboundIndexByMsgId.get(msgId);
      if (inboundIndex === undefined) continue;
      for (let i = inboundIndex + 1; i < responseSent.index; i++) {
        if (messages[i].role === "assistant" && assistantResponseText(messages[i])) {
          hiddenMessageIndexes.add(i);
        }
      }
    }

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (hiddenMessageIndexes.has(i)) continue;
      const inbound = extractComsNetInbound(msg);
      if (inbound) {
        const key = comsNetInboundKey(inbound);
        if (inbound.msgId && responseSentByMsgId.has(inbound.msgId)) {
          pendingInbound = null;
          inferredResponseIdx = null;
          continue;
        }
        pendingInbound = { ...inbound, index: i, key };
        inferredResponseIdx = null;
        continue;
      }

      if (isComsNetResponseSent(msg)) {
        if (inferredResponseIdx !== null) comsNetResponses.delete(inferredResponseIdx);
        pendingInbound = null;
        inferredResponseIdx = null;
        continue;
      }

      if (msg.role === "user") {
        pendingInbound = null;
        inferredResponseIdx = null;
        continue;
      }

      if (pendingInbound && msg.role === "assistant" && assistantResponseText(msg)) {
        comsNetResponses.set(i, {
          peer: pendingInbound.peer,
          msgId: pendingInbound.msgId,
        });
        inferredResponseIdx = i;
        pendingInbound = null;
        continue;
      }

      if (pendingInbound && msg.role === "assistant" && !assistantOnlyCallsComsNetTool(msg)) {
        pendingInbound = null;
        inferredResponseIdx = null;
      }
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      if (hiddenMessageIndexes.has(i)) continue;
      const msg = messages[i];
      if (msg.role === "toolResult") {
        toolResultsMap.set((msg as import("@/lib/types").ToolResultMessage).toolCallId, msg as import("@/lib/types").ToolResultMessage);
      }
      if (lastUserIdx < 0 && msg.role === "user") lastUserIdx = i;
      if (msg.role === "user") {
        seenAssistantSinceUser = false;
      } else if (msg.role === "assistant") {
        showTimestamp[i] = !seenAssistantSinceUser;
        seenAssistantSinceUser = true;
      }
    }

    if (streamState.isStreaming && messages.length > 0) {
      showTimestamp[messages.length - 1] = false;
    }

    return { toolResultsMap, lastUserIdx, showTimestamp, hiddenMessageIndexes, comsNetResponses };
  }, [messages, streamState.isStreaming]);

  const visibleMessages = useMemo(
    () => messages.filter((m, idx) => !messageRenderData.hiddenMessageIndexes.has(idx) && (m.role === "user" || m.role === "assistant")),
    [messages, messageRenderData.hiddenMessageIndexes],
  );
  const messageRefs = useMessageRefs(visibleMessages.length);

  const handleEditMessageContent = useCallback((content: string) => {
    chatInputRef?.current?.insertIfEmpty(content);
  }, [chatInputRef]);

  const draftStorageKey = session?.id
    ? `session:${session.id}`
    : newSessionCwd
      ? `cwd:${newSessionCwd}`
      : "new";
  const activeCwd = session?.cwd ?? newSessionCwd ?? null;
  const agentsMdElement = activeCwd ? <AgentsMdHint cwd={activeCwd} /> : null;

  const chatInputElement = (
    <ChatInput
      ref={chatInputRef}
      onSend={handleSend}
      onAbort={handleAbort}
      onSteer={agentRunning ? handleSteer : undefined}
      onFollowUp={agentRunning ? handleFollowUp : undefined}
      isStreaming={agentRunning}
      model={displayModelValue}
      modelNames={modelNames}
      modelList={modelList}
      onModelChange={handleModelChange}
      onCompact={session || isNew ? handleCompact : undefined}
      onAbortCompaction={handleAbortCompaction}
      isCompacting={isCompacting}
      compactError={compactError}
      contextUsage={contextUsage}
      thinkingLevel={thinkingLevel}
      onThinkingLevelChange={session || isNew ? handleThinkingLevelChange : undefined}
      planMode={planMode}
      planExecutionMode={planExecutionMode}
      planModeStatus={planModeStatus}
      onPlanModeChange={handlePlanModeChange}
      availableThinkingLevels={availableThinkingLevels}
      thinkingLevelMap={currentThinkingLevelMap}
      retryInfo={retryInfo}
      soundEnabled={soundEnabled}
      onSoundToggle={onSoundToggle}
      promptHistory={promptHistory}
      draftStorageKey={draftStorageKey}
      cwd={activeCwd}
    />
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-text-muted">
        Loading session...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center text-red-400">
        {error}
      </div>
    );
  }

  return (
    <div
      className="pi-chat-window relative flex h-full flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-50 flex animate-[drop-zone-in_0.15s_ease_both] items-center justify-center bg-[rgba(37,99,235,0.06)] backdrop-blur-[1px]">
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            {[0, 0.8, 1.6].map((delay) => (
              <div
                key={delay}
                className="absolute h-[720px] w-[720px] rounded-full border-[1.5px] border-solid border-[rgba(37,99,235,0.5)] animate-[drop-ripple_2.4s_ease-out_infinite_backwards]"
                style={{ transformOrigin: "center", animationDelay: `${delay}s` }}
              />
            ))}
          </div>
          <svg
            width="280" height="280" viewBox="0 0 140 140" fill="none" xmlns="http://www.w3.org/2000/svg"
            className="drop-shadow-[0_6px_18px_rgba(37,99,235,0.18)]"
          >
            <rect x="28" y="44" width="84" height="60" rx="8" fill="rgba(37,99,235,0.08)" stroke="rgba(37,99,235,0.50)" strokeWidth="1.8"/>
            <path d="M36 100 L54 72 L68 88 L80 74 L104 100Z" fill="rgba(37,99,235,0.16)" stroke="rgba(37,99,235,0.40)" strokeWidth="1.4" strokeLinejoin="round"/>
            <circle cx="96" cy="58" r="8" fill="rgba(37,99,235,0.22)" stroke="rgba(37,99,235,0.55)" strokeWidth="1.6"/>
            <g stroke="rgba(37,99,235,0.45)" strokeWidth="1.4" strokeLinecap="round">
              <line x1="96" y1="46" x2="96" y2="43"/>
              <line x1="96" y1="70" x2="96" y2="73"/>
              <line x1="84" y1="58" x2="81" y2="58"/>
              <line x1="108" y1="58" x2="111" y2="58"/>
              <line x1="87.5" y1="49.5" x2="85.4" y2="47.4"/>
              <line x1="104.5" y1="66.5" x2="106.6" y2="68.6"/>
              <line x1="104.5" y1="49.5" x2="106.6" y2="47.4"/>
              <line x1="87.5" y1="66.5" x2="85.4" y2="68.6"/>
            </g>
          </svg>
        </div>
      )}

      {isEmptyNew ? (
        <div
          className={`${isFluid ? "pi-fluid-empty-chat" : "pi-empty-chat"} flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8`}
          style={isFluid ? {
            padding: "76px 48px 42px",
            background: "transparent",
          } : undefined}
        >
          <div className="w-full max-w-[820px]">
            <div
              className="mb-3"
              style={{
                marginLeft: 16,
                marginRight: 52,
              }}
            >
              <BrandTypewriterHeader />
            </div>
            {agentsMdElement}
            {chatInputElement}
          </div>
        </div>
      ) : (
      <>
      <div
        className={`${isFluid ? "pi-fluid-chat-body" : "pi-chat-body"} relative flex flex-1 overflow-hidden`}
      >
        <div ref={scrollContainerRef} className="pi-chat-scroll flex-1 overflow-y-auto pt-4 [scrollbar-width:none]">
          <div className="pi-message-stack mx-auto max-w-[820px] px-4">

            {(() => {
              let refIdx = 0;
              const shouldUseLazyMessages = messages.length >= LAZY_MESSAGE_THRESHOLD;
              return messages.map((msg, idx) => {
                if (messageRenderData.hiddenMessageIndexes.has(idx)) return null;
                const messageKey = entryIds[idx] ?? `${msg.role}-${idx}`;
                const prevAssistantEntryId =
                  msg.role === "user" && idx > 0 && messages[idx - 1].role === "assistant"
                    ? entryIds[idx - 1]
                    : undefined;
                const isVisible = msg.role === "user" || msg.role === "assistant";
                const currentRefIdx = isVisible ? refIdx++ : -1;
                const shouldRenderEagerly =
                  !shouldUseLazyMessages ||
                  idx >= messages.length - LAZY_RECENT_MESSAGE_COUNT ||
                  idx === messageRenderData.lastUserIdx ||
                  forkingEntryId === entryIds[idx];
                const view = (
                  <MessageView
                    key={messageKey}
                    message={msg}
                    toolResults={messageRenderData.toolResultsMap}
                    runningToolIds={runningToolIds}
                    toolExecutionStatuses={toolExecutionStatuses}
                    modelNames={modelNames}
                    comsNetResponse={messageRenderData.comsNetResponses.get(idx)}
                    entryId={entryIds[idx]}
                    onFork={agentRunning || isNew || (idx === 0 && msg.role === "user") ? undefined : handleFork}
                    forking={forkingEntryId === entryIds[idx]}
                    onNavigate={agentRunning ? undefined : handleNavigate}
                    prevAssistantEntryId={agentRunning ? undefined : prevAssistantEntryId}
                    onEditContent={handleEditMessageContent}
                    showTimestamp={messageRenderData.showTimestamp[idx]}
                    prevTimestamp={idx > 0 ? (messages[idx - 1] as import("@/lib/types").AgentMessage & { timestamp?: number }).timestamp : undefined}
                    nextTimestamp={idx < messages.length - 1 ? (messages[idx + 1] as import("@/lib/types").AgentMessage & { timestamp?: number }).timestamp : undefined}
                  />
                );
                if (msg.role === "toolResult") return view;

                const registerRef = isVisible
                  ? (el: HTMLDivElement | null) => {
                      messageRefs.current[currentRefIdx] = el;
                      if (idx === messageRenderData.lastUserIdx) {
                        (lastUserMsgRef as { current: HTMLDivElement | null }).current = el;
                      }
                    }
                  : undefined;

                return (
                  <LazyMessageSlot
                    key={messageKey}
                    eager={shouldRenderEagerly}
                    estimatedHeight={estimateMessageHeight(msg)}
                    registerRef={registerRef}
                    scrollRoot={scrollContainerRef}
                  >
                    {view}
                  </LazyMessageSlot>
                );
              });
            })()}

            {streamState.isStreaming && streamState.streamingMessage && (
              <MessageView message={streamState.streamingMessage as AgentMessage} isStreaming runningToolIds={runningToolIds} toolExecutionStatuses={toolExecutionStatuses} modelNames={modelNames} />
            )}

            {agentRunning && !streamState.streamingMessage && (
              <div className="pi-running-phase py-2 text-[13px] text-text-muted">
                <span className="animate-[pulse_1.5s_infinite]">{phaseLabel(agentPhase)}</span>
              </div>
            )}

            <div ref={messagesEndRef} />

            {agentRunning && (
              <div style={{ height: scrollContainerRef.current ? scrollContainerRef.current.clientHeight : "80vh" }} />
            )}
          </div>
        </div>
        {!isFluid && (
          <ChatMinimap
            messages={messages}
            streamingMessage={streamState.streamingMessage}
            scrollContainer={scrollContainerRef}
            messageRefs={messageRefs}
          />
        )}
      </div>

      <div
        className={`${isFluid ? "pi-fluid-composer-dock" : "pi-composer-dock"} relative`}
        style={isFluid ? {
          background: "linear-gradient(180deg, transparent, color-mix(in srgb, var(--bg) 82%, transparent) 28px, color-mix(in srgb, var(--bg) 90%, transparent))",
        } : undefined}
      >
        {agentsMdElement}
        {chatInputElement}
      </div>
      </>
      )}
    </div>
  );
}
