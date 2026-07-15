"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { THEME_OPTIONS, type ThemeId } from "@/lib/themes";
import { useTheme } from "@/hooks/useTheme";
import { useLocale } from "@/lib/i18n";

interface Props {
  variant?: "topbar" | "footer" | "rail";
}

export function ThemeCycleButton({ variant = "topbar" }: Props) {
  const { theme, themeOption, setTheme } = useTheme();
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const isTopbar = variant === "topbar";
  const isFooter = variant === "footer";
  const isRail = variant === "rail";

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const chooseTheme = useCallback((next: ThemeId, origin: { x: number; y: number }) => {
    setTheme(next, origin);
    setOpen(false);
  }, [setTheme]);

  return (
    <span
      ref={wrapRef}
      style={{
        position: "relative",
        display: "flex",
        flex: isFooter ? 1 : undefined,
        minWidth: 0,
        alignItems: isRail ? "center" : undefined,
      }}
    >
    <button
      className={`pi-theme-cycle-button pi-theme-cycle-button-${variant}`}
      onClick={(e) => {
        e.stopPropagation();
        setOpen((current) => !current);
      }}
      title={`${t("theme.label")}: ${themeOption.label}`}
      aria-label={`${t("theme.label")}: ${themeOption.label}`}
      aria-expanded={open}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: isFooter ? 3 : 2,
        flex: isFooter ? 1 : undefined,
        width: isTopbar || isRail ? 36 : undefined,
        height: isTopbar || isRail ? 36 : 32,
        padding: isFooter ? "0 3px" : 0,
        background: isTopbar ? "none" : "transparent",
        border: "none",
        borderRight: isTopbar ? "1px solid var(--border)" : undefined,
        borderRadius: isTopbar ? 0 : 8,
        color: "var(--text-muted)",
        cursor: "pointer",
        flexShrink: 0,
        fontSize: isFooter ? 10.5 : 12,
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
      {isRail ? (
        <span
          aria-hidden="true"
          className="pi-theme-rail-icon"
          style={{
            width: 18,
            height: 18,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 2,
            padding: 2,
            borderRadius: 6,
            border: "1px solid color-mix(in srgb, var(--text) 18%, var(--border))",
            background: themeOption.surface,
            boxShadow: `0 0 0 3px color-mix(in srgb, ${themeOption.accent} 14%, transparent)`,
          }}
        >
          <span style={{ borderRadius: 3, background: themeOption.accent }} />
          <span style={{ borderRadius: 3, background: "var(--bg)" }} />
          <span style={{ borderRadius: 3, background: "var(--bg-hover)" }} />
          <span style={{ borderRadius: 3, background: "var(--text-muted)" }} />
        </span>
      ) : (
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
      )}
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
      {isFooter && <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t("theme.short")}</span>}
    </button>
    {open && (
      <div
        className="pi-theme-menu pi-popover"
        style={{
          position: "absolute",
          left: isRail ? "calc(100% + 8px)" : isTopbar ? 2 : 0,
          top: isTopbar ? "calc(100% + 6px)" : undefined,
          bottom: isRail ? 0 : isFooter ? "calc(100% + 8px)" : undefined,
          width: isRail ? 210 : 190,
          maxHeight: isRail ? "min(326px, calc(100dvh - 24px))" : 326,
          overflowY: "auto",
          padding: 6,
          border: "1px solid var(--border)",
          borderRadius: 8,
          background: "var(--bg-panel)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
          zIndex: 700,
        }}
      >
        {THEME_OPTIONS.map((option) => {
          const selected = option.id === theme;
          return (
            <button
              key={option.id}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                chooseTheme(option.id, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
              }}
              style={{
                width: "100%",
                height: 34,
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "0 8px",
                border: "none",
                borderRadius: 6,
                background: selected ? "var(--bg-selected)" : "transparent",
                color: selected ? "var(--text)" : "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: selected ? 650 : 500,
                textAlign: "left",
              }}
              onMouseEnter={(e) => { if (!selected) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (!selected) e.currentTarget.style.background = "transparent"; }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 34,
                  height: 18,
                  borderRadius: 5,
                  background: option.surface,
                  border: "1px solid var(--border)",
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 4,
                  flexShrink: 0,
                }}
              >
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: option.accent,
                    boxShadow: "0 0 0 2px rgba(255,255,255,0.6)",
                  }}
                />
              </span>
              <span style={{ flex: 1 }}>{option.label}</span>
              {selected && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          );
        })}
      </div>
    )}
    </span>
  );
}
