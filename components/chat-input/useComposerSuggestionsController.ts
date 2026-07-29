"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { apiPath } from "@/lib/api-path";
import { getSlashCommandQuery, type BuddyMode, type ModelRef, type PlanExecutionMode, type PlanMode, type PlanModeStatus, type SlashCommandQuery } from "@/lib/plan-mode";
import { buildWorkflowSlashCommands, getMentionQuery, type WorkflowSlashCommandOption } from "./helpers";
import type { FileMentionEntry, MentionQuery, Translate } from "./types";

interface Options {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  cwd?: string | null;
  isStreaming: boolean;
  planMode: PlanMode;
  planExecutionMode: PlanExecutionMode;
  planModeStatus?: PlanModeStatus | null;
  onPlanModeChange?: (mode: PlanMode, executionMode?: PlanExecutionMode) => boolean | Promise<boolean>;
  buddyMode: BuddyMode;
  buddyReviewerModel?: ModelRef | null;
  mainModel?: ModelRef | null;
  onBuddyModeChange?: (mode: BuddyMode) => boolean | Promise<boolean>;
  setInputValue: (value: string) => void;
  t: Translate;
}

export function useComposerSuggestionsController(options: Options) {
  const {
    textareaRef, cwd, isStreaming, planMode, planExecutionMode, planModeStatus,
    onPlanModeChange, buddyMode, buddyReviewerModel, mainModel, onBuddyModeChange, setInputValue, t,
  } = options;
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [mentionEntries, setMentionEntries] = useState<FileMentionEntry[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [slashQuery, setSlashQuery] = useState<SlashCommandQuery | null>(null);
  const [slashOpen, setSlashOpen] = useState(false);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [slashNotice, setSlashNotice] = useState<string | null>(null);
  const mentionPanelRef = useRef<HTMLDivElement>(null);
  const slashPanelRef = useRef<HTMLDivElement>(null);
  const noticeTimerRef = useRef<number | null>(null);
  const slashQueryText = slashQuery?.query;

  const showNotice = useCallback((message: string, duration: number) => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
    setSlashNotice(message);
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setSlashNotice(null);
    }, duration);
  }, []);

  const updateMentionState = useCallback((text: string, cursor?: number) => {
    const nextCursor = cursor ?? textareaRef.current?.selectionStart ?? text.length;
    const next = getMentionQuery(text, nextCursor);
    setMentionQuery(next);
    setMentionOpen(Boolean(cwd && next));
    setMentionSelectedIndex(0);
  }, [cwd, textareaRef]);

  const updateSlashState = useCallback((text: string, cursor?: number) => {
    const nextCursor = cursor ?? textareaRef.current?.selectionStart ?? text.length;
    const next = getSlashCommandQuery(text, nextCursor);
    setSlashQuery(next);
    setSlashOpen(Boolean(next));
    setSlashSelectedIndex(0);
  }, [textareaRef]);

  const slashCommands = useMemo(() => buildWorkflowSlashCommands({
    planMode, planExecutionMode, planModeStatus, buddyMode, buddyReviewerModel, mainModel,
    query: slashQueryText, t,
  }), [buddyMode, buddyReviewerModel, mainModel, planExecutionMode, planMode, planModeStatus, slashQueryText, t]);

  const insertMention = useCallback((entry: FileMentionEntry) => {
    const textarea = textareaRef.current;
    if (!textarea || !mentionQuery) return;
    const before = textarea.value.slice(0, mentionQuery.start);
    const after = textarea.value.slice(mentionQuery.end);
    const quoted = `\`${entry.path}${entry.isDir ? "/" : ""}\``;
    const suffix = after.startsWith(" ") ? "" : " ";
    setInputValue(before + quoted + suffix + after);
    setMentionOpen(false);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      const position = before.length + quoted.length + suffix.length;
      textarea.setSelectionRange(position, position);
      textarea.focus();
    });
  }, [mentionQuery, setInputValue, textareaRef]);

  const runSlashCommand = useCallback(async (command: WorkflowSlashCommandOption) => {
    if (isStreaming) {
      showNotice(t("chat.slash.runningDisabled"), 1800);
      return;
    }
    if (command.disabled) {
      showNotice(command.disabledReason === "reviewer-required"
        ? t("chat.slash.buddyReviewerRequired")
        : command.disabledReason === "same-model"
          ? t("chat.buddySameModel")
          : planModeStatus?.installCommand
          ? t("chat.slash.subagentInstall", { command: planModeStatus.installCommand })
          : t("chat.slash.runningDisabled"), 2600);
      return;
    }
    const ok = command.buddyMode !== "off"
      ? await Promise.resolve(onBuddyModeChange?.(command.buddyMode) ?? false)
      : await Promise.resolve(onPlanModeChange?.(command.mode, command.executionMode) ?? true);
    if (!ok) {
      showNotice(command.executionMode === "subagent"
        ? t("chat.slash.subagentInstall", { command: planModeStatus?.installCommand ?? "npx --no-install pi install npm:@tintinweb/pi-subagents" })
        : t("chat.slash.runningDisabled"), 2600);
      return;
    }
    const textarea = textareaRef.current;
    if (textarea && slashQuery) {
      setInputValue((textarea.value.slice(0, slashQuery.start) + textarea.value.slice(slashQuery.end)).replace(/^\s+/, ""));
    } else {
      setInputValue("");
    }
    setSlashOpen(false);
    setSlashQuery(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [isStreaming, onBuddyModeChange, onPlanModeChange, planModeStatus, setInputValue, showNotice, slashQuery, t, textareaRef]);

  const handleSuggestionKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    const plainKey = !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
    if (slashOpen && (event.key === "ArrowUp" || event.key === "ArrowDown") && plainKey) {
      event.preventDefault();
      if (slashCommands.length > 0) setSlashSelectedIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + slashCommands.length) % slashCommands.length);
      return true;
    }
    if (slashOpen && (event.key === "Enter" || event.key === "Tab") && plainKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      const selected = slashCommands[slashSelectedIndex];
      if (selected) void runSlashCommand(selected);
      return true;
    }
    if (slashOpen && event.key === "Escape") {
      event.preventDefault();
      setSlashOpen(false);
      return true;
    }
    if (mentionOpen && (event.key === "ArrowUp" || event.key === "ArrowDown") && plainKey) {
      event.preventDefault();
      if (mentionEntries.length > 0) setMentionSelectedIndex((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + mentionEntries.length) % mentionEntries.length);
      return true;
    }
    if (mentionOpen && (event.key === "Enter" || event.key === "Tab") && plainKey && !event.nativeEvent.isComposing) {
      const selected = mentionEntries[mentionSelectedIndex];
      if (selected) {
        event.preventDefault();
        insertMention(selected);
        return true;
      }
    }
    if (mentionOpen && event.key === "Escape") {
      event.preventDefault();
      setMentionOpen(false);
      return true;
    }
    return false;
  }, [insertMention, mentionEntries, mentionOpen, mentionSelectedIndex, runSlashCommand, slashCommands, slashOpen, slashSelectedIndex]);

  useEffect(() => {
    if (!cwd || !mentionQuery) {
      setMentionEntries([]);
      setMentionLoading(false);
      return;
    }
    const controller = new AbortController();
    setMentionLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(apiPath(`file-mentions?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(mentionQuery.query)}`), { signal: controller.signal });
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json() as { entries?: FileMentionEntry[] };
        setMentionEntries(data.entries ?? []);
        setMentionSelectedIndex(0);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setMentionEntries([]);
      } finally {
        if (!controller.signal.aborted) setMentionLoading(false);
      }
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [cwd, mentionQuery]);

  useEffect(() => {
    if (!mentionOpen) return;
    const panel = mentionPanelRef.current;
    const item = panel?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
    if (!panel || !item) return;
    const top = item.offsetTop;
    const bottom = top + item.offsetHeight;
    if (top < panel.scrollTop) panel.scrollTop = Math.max(0, top - 4);
    else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight + 4;
  }, [mentionOpen, mentionSelectedIndex]);

  useEffect(() => {
    if (!slashOpen) return;
    const frame = requestAnimationFrame(() => {
      const panel = slashPanelRef.current;
      const item = panel?.querySelector<HTMLElement>(`[data-slash-index="${slashSelectedIndex}"]`);
      if (!panel || !item) return;
      const top = item.offsetTop;
      const bottom = top + item.offsetHeight;
      if (top < panel.scrollTop) panel.scrollTop = Math.max(0, top - 4);
      else if (bottom > panel.scrollTop + panel.clientHeight) panel.scrollTop = bottom - panel.clientHeight + 4;
    });
    return () => cancelAnimationFrame(frame);
  }, [slashOpen, slashSelectedIndex]);

  useEffect(() => () => {
    if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current);
  }, []);

  return {
    mentionQuery, mentionEntries, mentionOpen, mentionSelectedIndex, mentionLoading, mentionPanelRef,
    slashQuery, slashOpen, slashSelectedIndex, slashNotice, slashCommands, slashPanelRef,
    setMentionOpen, setMentionSelectedIndex, setSlashOpen, setSlashSelectedIndex,
    updateMentionState, updateSlashState, insertMention, runSlashCommand, handleSuggestionKeyDown,
  };
}

export type ComposerSuggestionsController = ReturnType<typeof useComposerSuggestionsController>;
