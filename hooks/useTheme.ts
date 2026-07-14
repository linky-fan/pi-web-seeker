"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_THEME, getNextTheme, getThemeOption, normalizeTheme, type ThemeId } from "@/lib/themes";

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function applyTheme(theme: ThemeId): void {
  const option = getThemeOption(theme);
  const vars = option.vars;
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", option.isDark);
  document.documentElement.style.setProperty("--bg", vars.bg);
  document.documentElement.style.setProperty("--bg-panel", vars.bgPanel);
  document.documentElement.style.setProperty("--bg-hover", vars.bgHover);
  document.documentElement.style.setProperty("--bg-selected", vars.bgSelected);
  document.documentElement.style.setProperty("--border", vars.border);
  document.documentElement.style.setProperty("--text", vars.text);
  document.documentElement.style.setProperty("--text-muted", vars.textMuted);
  document.documentElement.style.setProperty("--text-dim", vars.textDim);
  document.documentElement.style.setProperty("--accent", vars.accent);
  document.documentElement.style.setProperty("--accent-hover", vars.accentHover);
  document.documentElement.style.setProperty("--user-bg", vars.userBg);
  document.documentElement.style.setProperty("--assistant-bg", vars.assistantBg);
  document.documentElement.style.setProperty("--tool-bg", vars.toolBg);
  document.documentElement.style.setProperty("--bg-subtle", vars.bgSubtle);
}

function getSnapshot(): ThemeId {
  if (typeof document === "undefined") return DEFAULT_THEME;
  const storedTheme = document.documentElement.dataset.theme;
  const theme = normalizeTheme(storedTheme);
  applyTheme(theme);
  if (storedTheme !== theme) {
    try {
      localStorage.setItem("pi-theme", theme);
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }
  return theme;
}

function getServerSnapshot(): ThemeId {
  return DEFAULT_THEME;
}

type ToggleOrigin = { x: number; y: number };

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const themeOption = getThemeOption(theme);

  const setTheme = useCallback((next: ThemeId, origin?: ToggleOrigin) => {
    const apply = () => {
      applyTheme(next);
      try {
        localStorage.setItem("pi-theme", next);
      } catch {
        // ignore storage errors (private mode, quota, etc.)
      }
      listeners.forEach((cb) => cb());
    };

    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";

    if (!supportsVT || reduceMotion) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 450,
            easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        // transition cancelled — ignore
      });
  }, []);

  const toggleTheme = useCallback((origin?: ToggleOrigin) => {
    setTheme(getNextTheme(getSnapshot()), origin);
  }, [setTheme]);

  return { theme, themeOption, setTheme, toggleTheme, isDark: themeOption.isDark };
}
