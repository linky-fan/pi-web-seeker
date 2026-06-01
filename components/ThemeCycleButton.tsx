"use client";

import { getNextTheme, getThemeOption } from "@/lib/themes";
import { useTheme } from "@/hooks/useTheme";

interface Props {
  variant?: "topbar" | "footer";
}

export function ThemeCycleButton({ variant = "topbar" }: Props) {
  const { theme, themeOption, toggleTheme } = useTheme();
  const nextTheme = getThemeOption(getNextTheme(theme));
  const isTopbar = variant === "topbar";
  const isFooter = variant === "footer";

  return (
    <button
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
      }}
      title={`Theme: ${themeOption.label}. Click for ${nextTheme.label}`}
      aria-label={`Theme: ${themeOption.label}`}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: isFooter ? 6 : 2,
        flex: isFooter ? 1 : undefined,
        width: isTopbar ? 36 : undefined,
        height: isTopbar ? 36 : 32,
        padding: 0,
        background: isTopbar ? "none" : "transparent",
        border: "none",
        borderRight: isTopbar ? "1px solid var(--border)" : undefined,
        borderRadius: isTopbar ? 0 : 9,
        color: "var(--text-muted)",
        cursor: "pointer",
        flexShrink: 0,
        fontSize: 12,
        transition: "color 0.12s, background 0.12s",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = "var(--text)";
        if (!isTopbar) e.currentTarget.style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = "var(--text-muted)";
        if (!isTopbar) e.currentTarget.style.background = "transparent";
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 15,
          height: 15,
          borderRadius: "50%",
          background: themeOption.accent,
          border: "1px solid color-mix(in srgb, var(--text) 18%, var(--border))",
          boxShadow: `inset 0 0 0 4px ${themeOption.surface}`,
        }}
      />
      {isTopbar && (
        <span
          aria-hidden="true"
          style={{
            width: 4,
            height: 4,
            borderRadius: "50%",
            background: "var(--text-dim)",
            opacity: 0.75,
          }}
        />
      )}
      {isFooter && <span>Theme</span>}
    </button>
  );
}
