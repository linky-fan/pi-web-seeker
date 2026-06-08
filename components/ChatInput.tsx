"use client";

import React, { useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef, KeyboardEvent, useId } from "react";
import { useLocale } from "@/lib/i18n";

export interface AttachedImage {
  data: string;   // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}

interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

interface ContextUsage {
  percent: number | null;
  contextWindow: number;
  tokens: number | null;
}

interface Props {
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
  toolPreset?: "none" | "default" | "full";
  onToolPresetChange?: (preset: "none" | "default" | "full") => void;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  promptHistory?: string[];
  draftStorageKey?: string;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  addImages: (files: File[]) => void;
}

const TOOL_PRESETS = ["off", "default", "full"] as const;
const TOOL_PRESET_MAP: Record<"off" | "default" | "full", "none" | "default" | "full"> = { off: "none", default: "default", full: "full" };

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh"] as const;
type ToolPresetLabel = typeof TOOL_PRESETS[number];

const DRAFT_STORAGE_KEY = "pi-web.chat.draft";
const HISTORY_STORAGE_KEY = "pi-web.chat.history";
const HISTORY_LIMIT = 50;

const PROMPT_SNIPPETS = [
  { labelKey: "snippets.review", text: "Review the current changes and call out bugs, risks, and missing tests." },
  { labelKey: "snippets.explain", text: "Explain how this part of the code works and where the important entry points are." },
  { labelKey: "snippets.tests", text: "Add focused tests for this behavior and run the relevant checks." },
  { labelKey: "snippets.refactor", text: "Refactor this with the smallest safe change while preserving behavior." },
  { labelKey: "snippets.summarize", text: "Summarize what changed, what was verified, and any remaining risks." },
];

function readStringArray(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeStringArray(key: string, values: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(values));
  } catch {
    // localStorage may be unavailable in private or restricted contexts
  }
}

function mergeHistory(...groups: string[][]): string[] {
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

function isLikelyFilePath(text: string): boolean {
  const value = text.trim();
  if (!value || value.includes("\n") || value.startsWith("`") || /^https?:\/\//i.test(value)) return false;
  if (/^([~.]?\/|\/|[a-zA-Z]:[\\/]|\\\\)/.test(value)) return true;
  return /^[\w .@+-]+[\\/][\w .@+\-/\\]+\.[A-Za-z0-9]{1,12}$/.test(value);
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(value);
}

function getModelContextProfile(model: { provider: string; modelId: string } | null | undefined): "deepseek-v4" | "standard-512k" {
  const modelId = model?.modelId.toLowerCase() ?? "";
  if (modelId.includes("deepseek") && modelId.includes("v4")) return "deepseek-v4";
  return "standard-512k";
}

function getContextTone(contextUsage: ContextUsage | null | undefined, model: { provider: string; modelId: string } | null | undefined): { color: string; bg: string; border: string } {
  const percent = contextUsage?.percent;
  const tokens = contextUsage?.tokens;
  const profile = getModelContextProfile(model);

  if (profile === "deepseek-v4" && tokens !== null && tokens !== undefined) {
    if (tokens >= 980_000) return { color: "#ef4444", bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.34)" };
    if (tokens >= 900_000) return { color: "rgba(234,179,8,0.98)", bg: "rgba(234,179,8,0.12)", border: "rgba(234,179,8,0.34)" };
    return { color: "#16a34a", bg: "rgba(22,163,74,0.08)", border: "rgba(22,163,74,0.24)" };
  }

  if (tokens !== null && tokens !== undefined) {
    if (tokens >= 512_000) return { color: "#ef4444", bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.34)" };
    if (tokens >= 450_000) return { color: "rgba(234,179,8,0.98)", bg: "rgba(234,179,8,0.12)", border: "rgba(234,179,8,0.34)" };
    return { color: "#16a34a", bg: "rgba(22,163,74,0.08)", border: "rgba(22,163,74,0.24)" };
  }

  if (percent !== null && percent !== undefined && percent >= 95) {
    return { color: "#ef4444", bg: "rgba(239,68,68,0.10)", border: "rgba(239,68,68,0.28)" };
  }
  if (percent !== null && percent !== undefined && percent >= 80) {
    return { color: "rgba(234,179,8,0.98)", bg: "rgba(234,179,8,0.10)", border: "rgba(234,179,8,0.28)" };
  }
  if (percent !== null && percent !== undefined && percent >= 60) {
    return { color: "var(--accent)", bg: "rgba(37,99,235,0.09)", border: "rgba(37,99,235,0.22)" };
  }
  if (percent !== null && percent !== undefined) {
    return { color: "#16a34a", bg: "rgba(22,163,74,0.08)", border: "rgba(22,163,74,0.22)" };
  }
  return { color: "var(--text-muted)", bg: "var(--bg-panel)", border: "var(--border)" };
}

function getContextUsageTitle(
  contextUsage: ContextUsage | null | undefined,
  isCompacting: boolean | undefined,
  model: { provider: string; modelId: string } | null | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  const action = isCompacting ? t("chat.stopCompactAction") : t("chat.compactAction");
  if (!contextUsage?.contextWindow) return `${action}\n${t("chat.contextUnavailable")}`;
  const percent = contextUsage.percent !== null ? `${contextUsage.percent.toFixed(1)}%` : t("stats.unknown");
  const tokens = contextUsage.tokens !== null ? `${formatTokenCount(contextUsage.tokens)} (${contextUsage.tokens.toLocaleString()})` : t("stats.unknown");
  const windowSize = `${formatTokenCount(contextUsage.contextWindow)} (${contextUsage.contextWindow.toLocaleString()})`;
  const profile = getModelContextProfile(model);
  const hint = profile === "deepseek-v4"
    ? t("chat.contextHint.deepseekV4")
    : t("chat.contextHint.standard512k");
  return `${action}\n${t("stats.context")}: ${percent}\n${t("chat.contextTokens")}: ${tokens} / ${windowSize}\n${hint}`;
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, onAbort, onSteer, onFollowUp, isStreaming, model, modelNames, modelList, onModelChange,
  onCompact, onAbortCompaction, isCompacting, compactError, contextUsage, toolPreset, onToolPresetChange,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  retryInfo,
  soundEnabled, onSoundToggle,
  promptHistory = [],
  draftStorageKey,
}: Props, ref) {
  const { t } = useLocale();
  const imageInputId = useId();
  const [value, setValue] = useState("");
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelDropdownRect, setModelDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [snippetDropdownOpen, setSnippetDropdownOpen] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const toolDropdownRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const snippetDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number | null>(null);
  const draftBeforeHistoryRef = useRef("");
  const effectiveDraftStorageKey = draftStorageKey ? `${DRAFT_STORAGE_KEY}:${draftStorageKey}` : DRAFT_STORAGE_KEY;

  useImperativeHandle(ref, () => ({
    insertIfEmpty(text: string) {
      const ta = textareaRef.current;
      const current = ta ? ta.value : value;
      if (current.trim()) return;
      setValue(text);
      requestAnimationFrame(() => {
        if (!ta) return;
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    insertText(text: string) {
      const ta = textareaRef.current;
      if (!ta) {
        setValue((v) => v + (v ? " " : "") + text);
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const before = ta.value.slice(0, start);
      const after = ta.value.slice(end);
      const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
      const newVal = before + sep + text + after;
      setValue(newVal);
      requestAnimationFrame(() => {
        if (!ta) return;
        const pos = start + sep.length + text.length;
        ta.setSelectionRange(pos, pos);
        ta.focus();
        ta.style.height = "auto";
        ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
      });
    },
    addImages(files: File[]) {
      processImageFiles(files);
    },
  }));

  const processImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const newImages = await Promise.all(
      imageFiles.map(
        (file) =>
          new Promise<AttachedImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              // result is "data:<mime>;base64,<data>"
              const base64 = result.split(",")[1];
              resolve({ data: base64, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          })
      )
    );
    setAttachedImages((prev) => [...prev, ...newImages]);
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].previewUrl);
      next.splice(index, 1);
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    setAttachedImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      return [];
    });
  }, []);

  const resizeTextarea = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, []);

  const setInputValue = useCallback((next: string) => {
    setValue(next);
    requestAnimationFrame(resizeTextarea);
  }, [resizeTextarea]);

  const rememberHistory = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const next = [trimmed, ...historyRef.current.filter((item) => item !== trimmed)].slice(0, HISTORY_LIMIT);
    historyRef.current = next;
    writeStringArray(HISTORY_STORAGE_KEY, next);
  }, []);

  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(effectiveDraftStorageKey);
    } catch {
      // ignore storage failures
    }
  }, [effectiveDraftStorageKey]);

  useEffect(() => {
    historyRef.current = mergeHistory(promptHistory, readStringArray(HISTORY_STORAGE_KEY));
    historyIndexRef.current = null;
  }, [promptHistory]);

  useEffect(() => {
    setInputValue("");
    try {
      const savedDraft = window.localStorage.getItem(effectiveDraftStorageKey);
      if (savedDraft) setInputValue(savedDraft);
    } catch {
      // ignore storage failures
    }
  }, [effectiveDraftStorageKey, setInputValue]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        if (value) window.localStorage.setItem(effectiveDraftStorageKey, value);
        else window.localStorage.removeItem(effectiveDraftStorageKey);
      } catch {
        // ignore storage failures
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [effectiveDraftStorageKey, value]);

  const handleSend = useCallback(async () => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    if (isStreaming) return;
    const sentImages = attachedImages.length ? attachedImages : undefined;
    const success = await Promise.resolve(onSend(msg, sentImages));
    if (success === false) {
      setInputValue(value);
      return;
    }
    rememberHistory(msg);
    historyIndexRef.current = null;
    draftBeforeHistoryRef.current = "";
    clearDraft();
    setInputValue("");
    clearImages();
  }, [value, attachedImages, isStreaming, onSend, clearImages, clearDraft, rememberHistory, setInputValue]);

  const sendQueued = useCallback((mode: "steer" | "followup") => {
    const msg = value.trim();
    if (!msg && !attachedImages.length) return;
    if (mode === "steer" && onSteer) {
      onSteer(msg, attachedImages.length ? attachedImages : undefined);
    } else if (mode === "followup" && onFollowUp) {
      onFollowUp(msg, attachedImages.length ? attachedImages : undefined);
    }
    rememberHistory(msg);
    clearDraft();
    setInputValue("");
    clearImages();
  }, [value, attachedImages, onSteer, onFollowUp, clearImages, clearDraft, rememberHistory, setInputValue]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.key === "ArrowUp" || e.key === "ArrowDown") && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const ta = e.currentTarget;
        const atStart = ta.selectionStart === 0 && ta.selectionEnd === 0;
        const atEnd = ta.selectionStart === ta.value.length && ta.selectionEnd === ta.value.length;
        const history = historyRef.current;
        const browsingHistory = historyIndexRef.current !== null;
        if (
          history.length > 0 &&
          (browsingHistory || (e.key === "ArrowUp" && atStart) || (e.key === "ArrowDown" && atEnd))
        ) {
          e.preventDefault();
          if (historyIndexRef.current === null) {
            draftBeforeHistoryRef.current = value;
          }
          if (e.key === "ArrowUp") {
            const nextIndex = historyIndexRef.current === null
              ? 0
              : Math.min(historyIndexRef.current + 1, history.length - 1);
            historyIndexRef.current = nextIndex;
            setInputValue(history[nextIndex]);
          } else {
            const nextIndex = historyIndexRef.current === null ? null : historyIndexRef.current - 1;
            if (nextIndex === null || nextIndex < 0) {
              historyIndexRef.current = null;
              setInputValue(draftBeforeHistoryRef.current);
            } else {
              historyIndexRef.current = nextIndex;
              setInputValue(history[nextIndex]);
            }
          }
        }
        return;
      }
      if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
        e.preventDefault();
        if (isStreaming && (onSteer || onFollowUp)) {
          // Default Enter sends as steer if available, else followup
          sendQueued(onSteer ? "steer" : "followup");
        } else {
          handleSend();
        }
      }
    },
    [value, isStreaming, onSteer, onFollowUp, sendQueued, handleSend, setInputValue]
  );

  const handleInput = useCallback(() => {
    resizeTextarea();
    historyIndexRef.current = null;
  }, [resizeTextarea]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length > 0) {
      e.preventDefault();
      const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
      processImageFiles(files);
      return;
    }

    const text = e.clipboardData?.getData("text/plain") ?? "";
    if (!isLikelyFilePath(text)) return;
    e.preventDefault();
    const ta = textareaRef.current;
    const quoted = "`" + text.trim() + "`";
    if (!ta) {
      setInputValue(value + (value ? " " : "") + quoted);
      return;
    }
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const sep = before.length > 0 && !before.endsWith(" ") ? " " : "";
    const next = before + sep + quoted + after;
    setInputValue(next);
    requestAnimationFrame(() => {
      const pos = start + sep.length + quoted.length;
      ta.setSelectionRange(pos, pos);
      ta.focus();
    });
  }, [processImageFiles, setInputValue, value]);

  const insertSnippet = useCallback((text: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setInputValue(value + (value ? "\n" : "") + text);
      return;
    }
    const start = ta.selectionStart ?? ta.value.length;
    const end = ta.selectionEnd ?? ta.value.length;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const sep = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    const next = before + sep + text + after;
    setInputValue(next);
    requestAnimationFrame(() => {
      const pos = start + sep.length + text.length;
      ta.setSelectionRange(pos, pos);
      ta.focus();
    });
  }, [setInputValue, value]);



  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name }));
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    }));
  })();

  // Group options by provider, preserving insertion order
  const modelsByProvider: { provider: string; options: ModelOption[] }[] = [];
  for (const opt of modelOptions) {
    const group = modelsByProvider.find((g) => g.provider === opt.provider);
    if (group) group.options.push(opt);
    else modelsByProvider.push({ provider: opt.provider, options: [opt] });
  }

  const currentName = model
    ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)?.name ?? model.modelId)
    : modelOptions.length > 0 ? modelOptions[0].name : null;

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        modelDropdownPanelRef.current && !modelDropdownPanelRef.current.contains(e.target as Node)
      ) {
        setModelDropdownOpen(false);
      }
      if (toolDropdownRef.current && !toolDropdownRef.current.contains(e.target as Node)) {
        setToolDropdownOpen(false);
      }
      if (thinkingDropdownRef.current && !thinkingDropdownRef.current.contains(e.target as Node)) {
        setThinkingDropdownOpen(false);
      }
      if (snippetDropdownRef.current && !snippetDropdownRef.current.contains(e.target as Node)) {
        setSnippetDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);



  return (
    <div
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: "0 16px 8px",
        paddingRight: 52, // 16px base + 36px for ChatMinimap alignment
      }}
    >
      {/* Hidden file input */}
      <input
        id={imageInputId}
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        tabIndex={-1}
        style={{
          position: "fixed",
          left: -10000,
          top: 0,
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: "none",
        }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          processImageFiles(files);
          e.target.value = "";
        }}
      />
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        {/* Retry banner */}
        {retryInfo && (
          <div style={{
            marginBottom: 8, padding: "5px 10px",
            background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)",
            borderRadius: 6, fontSize: 12, color: "rgba(180,130,0,0.9)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            {t("chat.retrying", { attempt: retryInfo.attempt, maxAttempts: retryInfo.maxAttempts })}{retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}> - {retryInfo.errorMessage}</span>}
          </div>
        )}
        {/* Image previews */}
        {attachedImages.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            {attachedImages.map((img, i) => (
              <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.previewUrl}
                  alt=""
                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", display: "block" }}
                />
                <button
                  onClick={() => removeImage(i)}
                  aria-label={t("chat.removeImage")}
                  title={t("chat.removeImage")}
                  style={{
                    position: "absolute", top: -4, right: -4,
                    width: 16, height: 16, borderRadius: "50%",
                    background: "var(--bg-panel)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", padding: 0, color: "var(--text-muted)",
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main input */}
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: "var(--bg)",
            border: `1px solid ${isStreaming && (onSteer || onFollowUp)
              ? "rgba(234,179,8,0.4)"
              : "color-mix(in srgb, var(--border) 70%, transparent)"}`,
            borderRadius: 14,
            padding: "10px 10px 10px 14px",
            boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10)",
            transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
          } as React.CSSProperties}
        >
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onPaste={handlePaste}
            placeholder={
              isStreaming && (onSteer || onFollowUp)
                ? t("chat.placeholder.streamingQueued")
                : isStreaming ? t("chat.placeholder.running")
                : t("chat.placeholder.message")
            }
            rows={1}
            style={{
              flex: 1,
              background: "none",
              border: "none",
              outline: "none",
              resize: "none",
              color: "var(--text)",
              fontSize: 14,
              lineHeight: 1.6,
              fontFamily: "inherit",
              minHeight: 24,
              maxHeight: 200,
              overflow: "auto",
            }}
          />

          {isStreaming ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, alignSelf: "flex-end" }}>
              {onSteer && (
                <button
                  onClick={() => sendQueued("steer")}
                  disabled={!value.trim() && !attachedImages.length}
                  title={t("chat.steerTitle")}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "7px 12px",
                    background: (value.trim() || attachedImages.length) ? "rgba(234,179,8,0.12)" : "none",
                    border: "1px solid rgba(234,179,8,0.35)",
                    borderRadius: 8,
                    color: (value.trim() || attachedImages.length) ? "rgba(180,130,0,1)" : "var(--text-dim)",
                    cursor: (value.trim() || attachedImages.length) ? "pointer" : "not-allowed",
                    fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em",
                    transition: "background 0.12s",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 1 L9 5 L5 9" /><line x1="1" y1="5" x2="9" y2="5" />
                  </svg>
                  {t("chat.steer")}
                </button>
              )}
              {onFollowUp && (
                <button
                  onClick={() => sendQueued("followup")}
                  disabled={!value.trim() && !attachedImages.length}
                  title={t("chat.followUpTitle")}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "7px 12px",
                    background: (value.trim() || attachedImages.length) ? "rgba(129,140,248,0.12)" : "none",
                    border: "1px solid rgba(129,140,248,0.35)",
                    borderRadius: 8,
                    color: (value.trim() || attachedImages.length) ? "rgba(99,102,241,1)" : "var(--text-dim)",
                    cursor: (value.trim() || attachedImages.length) ? "pointer" : "not-allowed",
                    fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em",
                    transition: "background 0.12s",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="1" x2="5" y2="6" /><polyline points="2.5 3.5 5 1 7.5 3.5" />
                    <line x1="2" y1="9" x2="8" y2="9" />
                  </svg>
                  {t("chat.followUp")}
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={handleSend}
              disabled={!value.trim() && !attachedImages.length}
              style={{
                flexShrink: 0,
                alignSelf: "flex-end",
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px",
                background: (value.trim() || attachedImages.length) ? "var(--accent)" : "var(--bg-panel)",
                border: "none",
                borderRadius: 8,
                color: (value.trim() || attachedImages.length) ? "#fff" : "var(--text-dim)",
                cursor: (value.trim() || attachedImages.length) ? "pointer" : "not-allowed",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                boxShadow: (value.trim() || attachedImages.length) ? "0 1px 3px rgba(37,99,235,0.25)" : "none",
                transition: "background 0.15s, box-shadow 0.15s",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="2" y1="7" x2="11" y2="7" />
                <polyline points="7.5 3 12 7 7.5 11" />
              </svg>
              {t("chat.send")}
            </button>
          )}
        </div>

        {/* Bottom bar: left | center (context) | right */}
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", rowGap: 6 }}>

          {/* LEFT: attach + snippets + model selector */}
          <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", rowGap: 4 }}>
            <label
              htmlFor={imageInputId}
              role="button"
              aria-label={t("chat.attachImage")}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
              title={t("chat.attachImage")}
              style={{
                flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                height: 32, padding: "0 8px",
                background: attachedImages.length ? "var(--bg-selected)" : "var(--bg-panel)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                color: attachedImages.length ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                whiteSpace: "nowrap",
                transition: "background 0.12s, color 0.12s, border-color 0.12s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text)";
                e.currentTarget.style.borderColor = "var(--accent)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = attachedImages.length ? "var(--bg-selected)" : "var(--bg-panel)";
                e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text-muted)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              <span style={{ lineHeight: 1 }}>{t("chat.attachImageShort")}</span>
              {attachedImages.length > 0 && (
                <span style={{
                  minWidth: 15, height: 15, padding: "0 4px",
                  borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: "var(--accent)", color: "#fff",
                  fontSize: 10, fontWeight: 700, lineHeight: 1,
                }}>
                  {attachedImages.length}
                </span>
              )}
            </label>
            <div ref={snippetDropdownRef} style={{ position: "relative", flexShrink: 0 }}>
              <button
                onClick={() => setSnippetDropdownOpen((v) => !v)}
                title={t("chat.promptSnippetsTitle")}
                aria-label={t("chat.promptSnippetsTitle")}
                aria-haspopup="menu"
                aria-expanded={snippetDropdownOpen}
                style={{
                  flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                  height: 32, padding: "0 9px",
                  background: snippetDropdownOpen ? "var(--bg-hover)" : "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  color: snippetDropdownOpen ? "var(--accent)" : "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.borderColor = "var(--accent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = snippetDropdownOpen ? "var(--bg-hover)" : "var(--bg-panel)";
                  e.currentTarget.style.color = snippetDropdownOpen ? "var(--accent)" : "var(--text-muted)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 6h16" />
                  <path d="M4 12h10" />
                  <path d="M4 18h7" />
                  <path d="M17 14l3 3-3 3" />
                </svg>
                <span style={{ lineHeight: 1 }}>{t("chat.promptSnippetsShort")}</span>
              </button>
              {snippetDropdownOpen && (
                <div
                  role="menu"
                  style={{
                    position: "absolute", bottom: "calc(100% + 6px)", left: 0,
                    zIndex: 100, background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                    overflow: "hidden", minWidth: 260, maxWidth: "calc(100vw - 32px)",
                  }}
                >
                  {PROMPT_SNIPPETS.map((snippet) => (
                    <button
                      key={snippet.labelKey}
                      role="menuitem"
                      onClick={() => {
                        setSnippetDropdownOpen(false);
                        insertSnippet(snippet.text);
                      }}
                      style={{
                        display: "grid", gridTemplateColumns: "72px minmax(0, 1fr)", gap: 8,
                        width: "100%", padding: "8px 12px",
                        background: "none", border: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer", fontSize: 12, textAlign: "left",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "var(--bg-hover)";
                        e.currentTarget.style.color = "var(--text)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "none";
                        e.currentTarget.style.color = "var(--text-muted)";
                      }}
                    >
                      <span style={{ color: "var(--text)", fontWeight: 600 }}>{t(snippet.labelKey)}</span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{snippet.text}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Model selector — visible always, disabled during streaming */}
            {modelOptions.length > 0 && currentName && onModelChange && (
                <div ref={dropdownRef} style={{ position: "relative" }}>
                  <button
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setModelDropdownRect({ top: rect.top, left: rect.left, width: rect.width });
                      setModelDropdownOpen((v) => !v);
                    }}
                    disabled={isStreaming}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "8px 12px",
                      height: 32,
                      maxWidth: 220, overflow: "hidden",
                      background: modelDropdownOpen ? "var(--bg-hover)" : "none",
                      border: "none",
                      borderRadius: 9,
                      color: "var(--text-muted)",
                      cursor: isStreaming ? "not-allowed" : "pointer",
                      fontSize: 12,
                      opacity: isStreaming ? 0.5 : 1,
                      transition: "background 0.12s, color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      if (isStreaming) return;
                      e.currentTarget.style.background = "var(--bg-hover)";
                      e.currentTarget.style.color = "var(--text)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = modelDropdownOpen ? "var(--bg-hover)" : "none";
                      e.currentTarget.style.color = "var(--text-muted)";
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="4" width="16" height="16" rx="2" />
                      <rect x="9" y="9" width="6" height="6" />
                      <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                      <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                      <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                      <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
                    </svg>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{currentName}</span>
                  </button>
                  {modelDropdownOpen && modelDropdownRect && (() => {
                    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
                    const bottom = viewportHeight - modelDropdownRect.top + 6;
                    const maxH = Math.max(120, Math.min(modelDropdownRect.top - 8, viewportHeight * 0.6));
                    return (
                    <div ref={modelDropdownPanelRef} style={{
                      position: "fixed",
                      bottom, left: modelDropdownRect.left,
                      zIndex: 500, background: "var(--bg)", border: "1px solid var(--border)",
                      borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                      overflow: "hidden", width: "max-content", minWidth: modelDropdownRect.width, maxHeight: maxH, overflowY: "auto",
                    }}>
                      {modelsByProvider.map((group, gi) => (
                        <div key={group.provider}>
                          {(modelsByProvider.length > 1) && (
                            <div style={{
                              padding: "6px 12px 4px",
                              fontSize: 10, fontWeight: 600, color: "var(--text-dim)",
                              textTransform: "uppercase", letterSpacing: "0.07em",
                              borderTop: gi > 0 ? "1px solid var(--border)" : "none",
                            }}>
                              {group.provider}
                            </div>
                          )}
                          {group.options.map((opt) => {
                            const isActive = opt.modelId === model?.modelId && opt.provider === model?.provider;
                            return (
                              <button
                                key={`${opt.provider}:${opt.modelId}`}
                                onClick={() => { setModelDropdownOpen(false); if (!isActive) onModelChange(opt.provider, opt.modelId); }}
                                style={{
                                  display: "flex", alignItems: "center", gap: 8,
                                  width: "100%", padding: "7px 12px",
                                  background: isActive ? "var(--bg-selected)" : "none",
                                  border: "none",
                                  color: isActive ? "var(--text)" : "var(--text-muted)",
                                  cursor: "pointer", fontSize: 12, textAlign: "left",
                                  fontWeight: isActive ? 600 : 400,
                                  whiteSpace: "nowrap",
                                }}
                                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                              >
                                {isActive
                                  ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                                  : <span style={{ width: 10, flexShrink: 0 }} />}
                                {opt.name}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    );
                  })()}
                </div>
            )}
          </div>

          {/* spacer */}
          <div style={{ flex: "1 1 24px", minWidth: 0 }} />

          {/* RIGHT: thinking + tools preset + compact + sound (idle) | Stop + sound (streaming) */}
          <div style={{ flex: "0 1 auto", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2, marginLeft: "auto", flexWrap: "wrap", rowGap: 4 }}>
            {!isStreaming && onThinkingLevelChange && (
              <div ref={thinkingDropdownRef} style={{ position: "relative" }}>
                <button
                  onClick={() => !isStreaming && setThinkingDropdownOpen((v) => !v)}
                  disabled={isStreaming}
                  title={t("chat.thinkingTitle")}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "8px 12px",
                    height: 32,
                    background: thinkingDropdownOpen ? "var(--bg-hover)" : "none",
                    border: "none",
                    borderRadius: 9,
                    color: "var(--text-muted)",
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    fontSize: 12,
                    opacity: isStreaming ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming) return;
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = thinkingDropdownOpen ? "var(--bg-hover)" : "none";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
                    <line x1="7" y1="18" x2="12" y2="18" />
                    <line x1="8" y1="21" x2="11" y2="21" />
                  </svg>
                  <span>{t("chat.thinkingShort")}: {(() => {
                    const lvl = thinkingLevel ?? "auto";
                    if (lvl === "auto" || !thinkingLevelMap) return t(`thinkingLabel.${lvl}`);
                    const mapped = thinkingLevelMap[lvl];
                    return mapped != null ? mapped : t(`thinkingLabel.${lvl}`);
                  })()}</span>
                </button>
                {thinkingDropdownOpen && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                    zIndex: 100, background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                    overflow: "hidden", minWidth: 180,
                  }}>
                    {THINKING_LEVELS.filter((lvl) => {
                      if (!availableThinkingLevels) return true;
                      if (lvl === "auto") return true;
                      return availableThinkingLevels.includes(lvl);
                    }).map((lvl) => {
                      const isActive = (thinkingLevel ?? "auto") === lvl;
                      const desc = t(`thinking.${lvl}`);
                      const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
                      const displayLabel = (mappedVal != null && mappedVal !== lvl) ? mappedVal : t(`thinkingLabel.${lvl}`);
                      const showOriginal = mappedVal != null && mappedVal !== lvl;
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setThinkingDropdownOpen(false); if (!isActive) onThinkingLevelChange(lvl); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%", padding: "7px 12px",
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            color: isActive ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer", fontSize: 12, textAlign: "left",
                            fontWeight: isActive ? 600 : 400,
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                        >
                          {isActive
                            ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                            : <span style={{ width: 10, flexShrink: 0 }} />}
                          <span style={{ flex: 1 }}>
                            {displayLabel}
                            {showOriginal && <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 5 }}>({t(`thinkingLabel.${lvl}`)})</span>}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {!isStreaming && onToolPresetChange && (
              <div ref={toolDropdownRef} style={{ position: "relative" }}>
                <button
                  onClick={() => !isStreaming && setToolDropdownOpen((v) => !v)}
                  disabled={isStreaming}
                  title={t("chat.toolsTitle")}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "8px 12px",
                    height: 32,
                    background: toolDropdownOpen ? "var(--bg-hover)" : "none",
                    border: "none",
                    borderRadius: 9,
                    color: "var(--text-muted)",
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    fontSize: 12,
                    opacity: isStreaming ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming) return;
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = toolDropdownOpen ? "var(--bg-hover)" : "none";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  </svg>
                  <span>{t("chat.toolsShort")}: {t(`toolsLabel.${(Object.entries(TOOL_PRESET_MAP).find(([, v]) => v === (toolPreset ?? "default"))?.[0] ?? "default") as ToolPresetLabel}`)}</span>
                </button>
                {toolDropdownOpen && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                    zIndex: 100, background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                    overflow: "hidden", minWidth: 120,
                  }}>
                    {TOOL_PRESETS.map((lvl) => {
                      const preset = TOOL_PRESET_MAP[lvl];
                      const isActive = (toolPreset ?? "default") === preset;
                      const desc = lvl === "off" ? t("tools.offDesc") : lvl === "default" ? t("tools.defaultDesc") : t("tools.fullDesc");
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setToolDropdownOpen(false); if (!isActive) onToolPresetChange(preset); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%", padding: "7px 12px",
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            color: isActive ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer", fontSize: 12, textAlign: "left",
                            fontWeight: isActive ? 600 : 400,
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                        >
                          {isActive
                            ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                            : <span style={{ width: 10, flexShrink: 0 }} />}
                          <span style={{ flex: 1 }}>{t(`toolsLabel.${lvl}`)}</span>
                          <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!isStreaming && onCompact && (() => {
              const contextPercent = contextUsage?.percent ?? null;
              const contextTone = getContextTone(contextUsage, model);
              const hasContextWindow = !!contextUsage?.contextWindow;
              const contextLabel = hasContextWindow
                ? (contextPercent !== null ? `${Math.round(contextPercent)}%` : "?")
                : "--";
              const contextFill = hasContextWindow && contextPercent !== null ? Math.max(4, Math.min(100, contextPercent)) : 0;
              const compactBg = isCompacting ? "rgba(239,68,68,0.08)" : hasContextWindow ? contextTone.bg : "none";
              const compactColor = isCompacting ? "#ef4444" : hasContextWindow ? contextTone.color : "var(--text-muted)";
              const compactBorder = isCompacting ? "rgba(239,68,68,0.28)" : hasContextWindow ? contextTone.border : "transparent";
              return (
              <div style={{ position: "relative" }}>
                {compactError && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                    background: "#1f2937", color: "#f87171",
                    fontSize: 11, padding: "4px 8px", borderRadius: 5,
                    whiteSpace: "nowrap", pointerEvents: "none",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.2)", zIndex: 50,
                  }}>
                    {compactError}
                  </div>
                )}
                <button
                  onClick={isCompacting ? onAbortCompaction : onCompact}
                  disabled={isStreaming && !isCompacting}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "8px 12px",
                    height: 32,
                    background: compactBg,
                    border: `1px solid ${compactBorder}`,
                    borderRadius: 9,
                    color: compactColor,
                    cursor: (isStreaming && !isCompacting) ? "not-allowed" : "pointer",
                    fontSize: 12, opacity: (isStreaming && !isCompacting) ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s, border-color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming && !isCompacting) return;
                    e.currentTarget.style.background = isCompacting ? "rgba(239,68,68,0.16)" : hasContextWindow ? contextTone.bg : "var(--bg-hover)";
                    e.currentTarget.style.color = compactColor;
                    e.currentTarget.style.borderColor = compactBorder;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = compactBg;
                    e.currentTarget.style.color = compactColor;
                    e.currentTarget.style.borderColor = compactBorder;
                  }}
                  title={getContextUsageTitle(contextUsage, isCompacting, model, t)}
                >
                  {isCompacting ? (
                    <><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" /></svg>{t("chat.compacting")}</>
                  ) : (
                    <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                      <line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" />
                    </svg>{t("chat.compact")}</>
                  )}
                  <span
                    aria-label={hasContextWindow ? t("chat.contextUsage", { label: contextLabel }) : t("chat.contextUsageUnavailable")}
                    style={{
                      display: "grid",
                      gap: 2,
                      width: 34,
                      minWidth: 34,
                      padding: "3px 5px",
                      borderRadius: 7,
                      border: `1px solid ${contextTone.border}`,
                      background: contextTone.bg,
                      color: contextTone.color,
                      fontSize: 10,
                      lineHeight: 1,
                      fontFamily: "var(--font-mono)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    <span style={{ textAlign: "center" }}>{contextLabel}</span>
                    <span style={{
                      position: "relative",
                      display: "block",
                      height: 2,
                      overflow: "hidden",
                      borderRadius: 999,
                      background: "rgba(127,127,127,0.18)",
                    }}>
                      <span style={{
                        position: "absolute",
                        inset: "0 auto 0 0",
                        width: `${contextFill}%`,
                        borderRadius: 999,
                        background: contextTone.color,
                      }} />
                    </span>
                  </span>
                </button>
              </div>
              );
            })()}

            {isStreaming && (
              <button
                onClick={onAbort}
                title={t("chat.stopTitle")}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 14px",
                  height: 32,
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 9,
                  color: "#ef4444",
                  cursor: "pointer",
                  fontSize: 12, fontWeight: 600,
                  whiteSpace: "nowrap", letterSpacing: "-0.01em",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.16)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" />
                </svg>
                {t("chat.stop")}
              </button>
            )}

            {onSoundToggle !== undefined && (
              <button
                onClick={onSoundToggle}
                title={soundEnabled ? t("chat.soundOnTitle") : t("chat.soundOffTitle")}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, padding: 0,
                  background: "none",
                  border: "none",
                  borderRadius: 9,
                  color: soundEnabled ? "var(--text-muted)" : "var(--text-dim)",
                  cursor: "pointer",
                  opacity: soundEnabled ? 1 : 0.55,
                  transition: "background 0.12s, color 0.12s, opacity 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.color = soundEnabled ? "var(--text-muted)" : "var(--text-dim)";
                  e.currentTarget.style.opacity = soundEnabled ? "1" : "0.55";
                }}
              >
                {soundEnabled ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                )}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
});
