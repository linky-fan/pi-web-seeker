"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type RefObject } from "react";
import { HISTORY_LIMIT, getDraftStorageKey, isLikelyFilePath, mergeHistory, navigateHistory } from "./helpers";
import type { AttachedImage, ChatInputHandle, ComposerActivity } from "./types";

const HISTORY_STORAGE_KEY = "pi-web.chat.history";

interface Options {
  onSend: (message: string, images?: AttachedImage[]) => boolean | Promise<boolean>;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  isStreaming: boolean;
  promptHistory: string[];
  draftStorageKey?: string;
  onActivityChange?: (activity: ComposerActivity) => void;
}

function readHistory(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(HISTORY_STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function writeHistory(values: string[]): void {
  try {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(values));
  } catch {
    // localStorage may be unavailable in private or restricted contexts
  }
}

export function useComposerDraftController(options: Options) {
  const { onSend, onSteer, onFollowUp, isStreaming, promptHistory, draftStorageKey, onActivityChange } = options;
  const [value, setValue] = useState("");
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef<number | null>(null);
  const draftBeforeHistoryRef = useRef("");
  const valueRef = useRef(value);
  const imagesRef = useRef(attachedImages);
  const mountedRef = useRef(true);
  const resizeFrameRef = useRef<number | null>(null);
  const effectiveDraftStorageKey = getDraftStorageKey(draftStorageKey);
  const canSend = value.trim().length > 0 || attachedImages.length > 0;
  const hasDraft = canSend;

  valueRef.current = value;
  imagesRef.current = attachedImages;

  const resizeTextarea = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, []);

  const scheduleResize = useCallback(() => {
    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      resizeTextarea();
    });
  }, [resizeTextarea]);

  const setInputValue = useCallback((next: string) => {
    valueRef.current = next;
    setValue(next);
    scheduleResize();
  }, [scheduleResize]);

  const clearDraft = useCallback(() => {
    try {
      window.localStorage.removeItem(effectiveDraftStorageKey);
    } catch {
      // Ignore storage failures.
    }
  }, [effectiveDraftStorageKey]);

  const rememberHistory = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const next = [trimmed, ...historyRef.current.filter((item) => item !== trimmed)].slice(0, HISTORY_LIMIT);
    historyRef.current = next;
    writeHistory(next);
  }, []);

  const clearImages = useCallback(() => {
    setAttachedImages((previous) => {
      previous.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      imagesRef.current = [];
      return [];
    });
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((previous) => {
      const next = [...previous];
      const removed = next[index];
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      next.splice(index, 1);
      imagesRef.current = next;
      return next;
    });
  }, []);

  const processImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    const results = await Promise.all(imageFiles.map((file) => new Promise<AttachedImage | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result ?? "");
        const comma = result.indexOf(",");
        if (comma < 0) {
          resolve(null);
          return;
        }
        resolve({ data: result.slice(comma + 1), mimeType: file.type, previewUrl: URL.createObjectURL(file) });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    })));
    const nextImages = results.filter((image): image is AttachedImage => image !== null);
    if (!mountedRef.current) {
      nextImages.forEach((image) => URL.revokeObjectURL(image.previewUrl));
      return;
    }
    setAttachedImages((previous) => {
      const next = [...previous, ...nextImages];
      imagesRef.current = next;
      return next;
    });
  }, []);

  const insertText = useCallback((text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      const current = valueRef.current;
      setInputValue(current + (current ? " " : "") + text);
      return;
    }
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const before = textarea.value.slice(0, start);
    const separator = before.length > 0 && !before.endsWith(" ") ? " " : "";
    setInputValue(before + separator + text + textarea.value.slice(end));
    requestAnimationFrame(() => {
      const position = start + separator.length + text.length;
      textarea.setSelectionRange(position, position);
      textarea.focus();
    });
  }, [setInputValue]);

  const insertIfEmpty = useCallback((text: string) => {
    const textarea = textareaRef.current;
    if ((textarea?.value ?? valueRef.current).trim()) return;
    setInputValue(text);
    requestAnimationFrame(() => textarea?.focus());
  }, [setInputValue]);

  const insertSnippet = useCallback((text: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      const current = valueRef.current;
      setInputValue(current + (current ? "\n" : "") + text);
      return;
    }
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const before = textarea.value.slice(0, start);
    const separator = before.length > 0 && !before.endsWith("\n") ? "\n" : "";
    setInputValue(before + separator + text + textarea.value.slice(end));
    requestAnimationFrame(() => {
      const position = start + separator.length + text.length;
      textarea.setSelectionRange(position, position);
      textarea.focus();
    });
  }, [setInputValue]);

  const handlePaste = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length > 0) {
      event.preventDefault();
      void processImageFiles(imageItems.map((item) => item.getAsFile()).filter((file): file is File => file !== null));
      return;
    }
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!isLikelyFilePath(text)) return;
    event.preventDefault();
    const textarea = textareaRef.current;
    const quoted = `\`${text.trim()}\``;
    if (!textarea) {
      const current = valueRef.current;
      setInputValue(current + (current ? " " : "") + quoted);
      return;
    }
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    const before = textarea.value.slice(0, start);
    const separator = before.length > 0 && !before.endsWith(" ") ? " " : "";
    setInputValue(before + separator + quoted + textarea.value.slice(end));
    requestAnimationFrame(() => {
      const position = start + separator.length + quoted.length;
      textarea.setSelectionRange(position, position);
      textarea.focus();
    });
  }, [processImageFiles, setInputValue]);

  const handleSend = useCallback(async () => {
    const message = value.trim();
    if ((!message && attachedImages.length === 0) || isStreaming) return;
    const success = await Promise.resolve(onSend(message, attachedImages.length ? attachedImages : undefined));
    if (success === false) {
      setInputValue(value);
      return;
    }
    rememberHistory(message);
    historyIndexRef.current = null;
    draftBeforeHistoryRef.current = "";
    clearDraft();
    setInputValue("");
    clearImages();
  }, [attachedImages, clearDraft, clearImages, isStreaming, onSend, rememberHistory, setInputValue, value]);

  const sendQueued = useCallback((mode: "steer" | "followup") => {
    const message = value.trim();
    if (!message && attachedImages.length === 0) return;
    if (mode === "steer" && onSteer) onSteer(message, attachedImages.length ? attachedImages : undefined);
    else if (mode === "followup" && onFollowUp) onFollowUp(message, attachedImages.length ? attachedImages : undefined);
    rememberHistory(message);
    clearDraft();
    setInputValue("");
    clearImages();
  }, [attachedImages, clearDraft, clearImages, onFollowUp, onSteer, rememberHistory, setInputValue, value]);

  const browseHistory = useCallback((key: "ArrowUp" | "ArrowDown", atStart: boolean, atEnd: boolean): boolean => {
    const next = navigateHistory(historyRef.current, historyIndexRef.current, draftBeforeHistoryRef.current, valueRef.current, key, atStart, atEnd);
    if (!next) return false;
    historyIndexRef.current = next.index;
    draftBeforeHistoryRef.current = next.draftBeforeHistory;
    setInputValue(next.value);
    return true;
  }, [setInputValue]);

  const resetHistoryNavigation = useCallback(() => {
    historyIndexRef.current = null;
  }, []);

  useEffect(() => {
    onActivityChange?.({ focused, hasDraft });
  }, [focused, hasDraft, onActivityChange]);

  useEffect(() => () => onActivityChange?.({ focused: false, hasDraft: false }), [onActivityChange]);

  useEffect(() => {
    historyRef.current = mergeHistory(promptHistory, readHistory());
    historyIndexRef.current = null;
  }, [promptHistory]);

  useEffect(() => {
    setInputValue("");
    try {
      const savedDraft = window.localStorage.getItem(effectiveDraftStorageKey);
      if (savedDraft) setInputValue(savedDraft);
    } catch {
      // Ignore storage failures.
    }
  }, [effectiveDraftStorageKey, setInputValue]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        if (value) window.localStorage.setItem(effectiveDraftStorageKey, value);
        else window.localStorage.removeItem(effectiveDraftStorageKey);
      } catch {
        // Ignore storage failures.
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [effectiveDraftStorageKey, value]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
      imagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
  }, []);

  const imperativeHandle = useMemo<ChatInputHandle>(() => ({ insertText, insertIfEmpty, addImages: processImageFiles }), [insertIfEmpty, insertText, processImageFiles]);

  return {
    value, setValue, attachedImages, canSend, textareaRef, fileInputRef, imperativeHandle,
    setFocused, resizeTextarea, resetHistoryNavigation, setInputValue, removeImage,
    processImageFiles, insertSnippet, handlePaste, handleSend, sendQueued, browseHistory,
  };
}

export type ComposerDraftController = ReturnType<typeof useComposerDraftController>;
export type ComposerTextareaRef = RefObject<HTMLTextAreaElement | null>;
