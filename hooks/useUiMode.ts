"use client";

import { useCallback, useSyncExternalStore } from "react";

export type UiMode = "classic" | "fluid";

const DEFAULT_UI_MODE: UiMode = "fluid";
const STORAGE_KEY = "pi-ui-mode";
const CHANGE_EVENT = "pi-ui-mode-change";
const listeners = new Set<() => void>();

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    applyUiMode(normalizeUiMode(event.newValue));
    callback();
  };
  const handleUiModeChange = () => callback();
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
    window.addEventListener(CHANGE_EVENT, handleUiModeChange);
  }
  return () => {
    listeners.delete(callback);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(CHANGE_EVENT, handleUiModeChange);
    }
  };
}

function normalizeUiMode(value: string | null | undefined): UiMode {
  return value === "classic" || value === "fluid" ? value : DEFAULT_UI_MODE;
}

function applyUiMode(mode: UiMode): void {
  document.documentElement.dataset.ui = mode;
}

function getSnapshot(): UiMode {
  if (typeof document === "undefined") return DEFAULT_UI_MODE;
  return normalizeUiMode(document.documentElement.dataset.ui);
}

function getServerSnapshot(): UiMode {
  return DEFAULT_UI_MODE;
}

export function useUiMode() {
  const uiMode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setUiMode = useCallback((next: UiMode) => {
    applyUiMode(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage can be unavailable in private or restricted contexts.
    }
    listeners.forEach((callback) => callback());
  }, []);

  const toggleUiMode = useCallback(() => {
    setUiMode(getSnapshot() === "fluid" ? "classic" : "fluid");
  }, [setUiMode]);

  return {
    uiMode,
    isFluid: uiMode === "fluid",
    setUiMode,
    toggleUiMode,
  };
}
