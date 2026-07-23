"use client";

import { memo } from "react";
import { getContextTone, getContextUsageTitle, visibleThinkingLevels } from "./helpers";
import type { ComposerMenusController } from "./useComposerMenusController";
import type { ContextUsage, ThinkingLevel, Translate } from "./types";

interface Props {
  menus: ComposerMenusController;
  isStreaming: boolean;
  onAbort: () => void;
  model?: { provider: string; modelId: string } | null;
  thinkingLevel?: ThinkingLevel;
  onThinkingLevelChange?: (level: ThinkingLevel) => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  contextUsage?: ContextUsage | null;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
  t: Translate;
}

export const ComposerRuntimeControls = memo(function ComposerRuntimeControls(props: Props) {
  const { menus } = props;
  return (
    <div style={{ flex: "0 1 auto", minWidth: 0, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 2, marginLeft: "auto", flexWrap: "wrap", rowGap: 4 }}>
      {!props.isStreaming && props.onThinkingLevelChange && (
        <div ref={menus.thinkingDropdownRef} data-motion-control style={{ position: "relative" }}>
          <button
            onClick={() => menus.setThinkingDropdownOpen((open) => !open)}
            title={props.t("chat.thinkingTitle")}
            style={{
              display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", height: 32,
              background: menus.thinkingDropdownOpen ? "var(--bg-hover)" : "none", border: "none", borderRadius: 9,
              color: "var(--text-muted)", cursor: "pointer", fontSize: 12, transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(event) => {
              event.currentTarget.style.background = "var(--bg-hover)";
              event.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = menus.thinkingDropdownOpen ? "var(--bg-hover)" : "none";
              event.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
              <line x1="7" y1="18" x2="12" y2="18" /><line x1="8" y1="21" x2="11" y2="21" />
            </svg>
            <span>{props.t("chat.thinkingShort")}: {(() => {
              const level = props.thinkingLevel ?? "auto";
              if (level === "auto" || !props.thinkingLevelMap) return props.t(`thinkingLabel.${level}`);
              return props.thinkingLevelMap[level] ?? props.t(`thinkingLabel.${level}`);
            })()}</span>
          </button>
          {menus.thinkingDropdownOpen && (
            <div ref={menus.thinkingDropdownPanelRef} className="pi-popover pi-thinking-popover" style={{
              position: "absolute", bottom: "calc(100% + 6px)", right: 0, zIndex: 100,
              background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 8,
              boxShadow: "0 -4px 16px rgba(0,0,0,0.10)", overflow: "hidden", minWidth: 180,
            }}>
              {visibleThinkingLevels(props.availableThinkingLevels).map((level) => {
                const active = (props.thinkingLevel ?? "auto") === level;
                const mapped = level !== "auto" ? props.thinkingLevelMap?.[level] : undefined;
                const displayLabel = mapped != null && mapped !== level ? mapped : props.t(`thinkingLabel.${level}`);
                const showOriginal = mapped != null && mapped !== level;
                return (
                  <button
                    key={level}
                    onClick={() => {
                      menus.setThinkingDropdownOpen(false);
                      if (!active) props.onThinkingLevelChange?.(level);
                    }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 12px",
                      background: active ? "var(--bg-selected)" : "none", border: "none",
                      color: active ? "var(--text)" : "var(--text-muted)", cursor: "pointer", fontSize: 12,
                      textAlign: "left", fontWeight: active ? 600 : 400, whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(event) => { if (!active) event.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(event) => { if (!active) event.currentTarget.style.background = "none"; }}
                  >
                    {active ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg> : <span style={{ width: 10, flexShrink: 0 }} />}
                    <span style={{ flex: 1 }}>
                      {displayLabel}
                      {showOriginal && <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 5 }}>({props.t(`thinkingLabel.${level}`)})</span>}
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{props.t(`thinking.${level}`)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {!props.isStreaming && props.onCompact && (() => {
        const contextPercent = props.contextUsage?.percent ?? null;
        const contextTone = getContextTone(props.contextUsage, props.model);
        const hasContextWindow = Boolean(props.contextUsage?.contextWindow);
        const contextLabel = hasContextWindow ? (contextPercent !== null ? `${Math.round(contextPercent)}%` : "?") : "--";
        const contextFill = hasContextWindow && contextPercent !== null ? Math.max(4, Math.min(100, contextPercent)) : 0;
        const compactBg = props.isCompacting ? "rgba(239,68,68,0.08)" : hasContextWindow ? contextTone.bg : "none";
        const compactColor = props.isCompacting ? "#ef4444" : hasContextWindow ? contextTone.color : "var(--text-muted)";
        const compactBorder = props.isCompacting ? "rgba(239,68,68,0.28)" : hasContextWindow ? contextTone.border : "transparent";
        return (
          <div data-motion-control style={{ position: "relative" }}>
            {props.compactError && <div style={{ position: "absolute", bottom: "calc(100% + 6px)", right: 0, background: "#1f2937", color: "#f87171", fontSize: 11, padding: "4px 8px", borderRadius: 5, whiteSpace: "nowrap", pointerEvents: "none", boxShadow: "0 2px 8px rgba(0,0,0,0.2)", zIndex: 50 }}>{props.compactError}</div>}
            <button
              onClick={props.isCompacting ? props.onAbortCompaction : props.onCompact}
              style={{
                display: "flex", alignItems: "center", gap: 5, padding: "8px 12px", height: 32,
                background: compactBg, border: `1px solid ${compactBorder}`, borderRadius: 9,
                color: compactColor, cursor: "pointer", fontSize: 12,
                transition: "background 0.12s, color 0.12s, border-color 0.12s",
              }}
              onMouseEnter={(event) => {
                event.currentTarget.style.background = props.isCompacting ? "rgba(239,68,68,0.16)" : hasContextWindow ? contextTone.bg : "var(--bg-hover)";
                event.currentTarget.style.color = compactColor;
                event.currentTarget.style.borderColor = compactBorder;
              }}
              onMouseLeave={(event) => {
                event.currentTarget.style.background = compactBg;
                event.currentTarget.style.color = compactColor;
                event.currentTarget.style.borderColor = compactBorder;
              }}
              title={getContextUsageTitle(props.contextUsage, props.isCompacting, props.model, props.t)}
            >
              {props.isCompacting ? (
                <><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" /></svg>{props.t("chat.compacting")}</>
              ) : (
                <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" /><line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" /></svg>{props.t("chat.compact")}</>
              )}
              <span
                aria-label={hasContextWindow ? props.t("chat.contextUsage", { label: contextLabel }) : props.t("chat.contextUsageUnavailable")}
                style={{ display: "grid", gap: 2, width: 34, minWidth: 34, padding: "3px 5px", borderRadius: 7, border: `1px solid ${contextTone.border}`, background: contextTone.bg, color: contextTone.color, fontSize: 10, lineHeight: 1, fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" }}
              >
                <span style={{ textAlign: "center" }}>{contextLabel}</span>
                <span style={{ position: "relative", display: "block", height: 2, overflow: "hidden", borderRadius: 999, background: "rgba(127,127,127,0.18)" }}>
                  <span style={{ position: "absolute", inset: "0 auto 0 0", width: `${contextFill}%`, borderRadius: 999, background: contextTone.color }} />
                </span>
              </span>
            </button>
          </div>
        );
      })()}

      {props.isStreaming && (
        <button
          data-motion-control onClick={props.onAbort} title={props.t("chat.stopTitle")}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", height: 32, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 9, color: "#ef4444", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", letterSpacing: "-0.01em", transition: "background 0.12s" }}
          onMouseEnter={(event) => { event.currentTarget.style.background = "rgba(239,68,68,0.16)"; }}
          onMouseLeave={(event) => { event.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" /></svg>
          {props.t("chat.stop")}
        </button>
      )}

      {props.onSoundToggle !== undefined && (
        <button
          data-motion-control onClick={props.onSoundToggle}
          title={props.soundEnabled ? props.t("chat.soundOnTitle") : props.t("chat.soundOffTitle")}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 32, padding: 0, background: "none", border: "none", borderRadius: 9, color: props.soundEnabled ? "var(--text-muted)" : "var(--text-dim)", cursor: "pointer", opacity: props.soundEnabled ? 1 : 0.55, transition: "background 0.12s, color 0.12s, opacity 0.12s" }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "var(--bg-hover)";
            event.currentTarget.style.color = "var(--text)";
            event.currentTarget.style.opacity = "1";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = "none";
            event.currentTarget.style.color = props.soundEnabled ? "var(--text-muted)" : "var(--text-dim)";
            event.currentTarget.style.opacity = props.soundEnabled ? "1" : "0.55";
          }}
        >
          {props.soundEnabled ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M15.54 8.46a5 5 0 0 1 0 7.07" /><path d="M19.07 4.93a10 10 0 0 1 0 14.14" /></svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="23" y1="9" x2="17" y2="15" /><line x1="17" y1="9" x2="23" y2="15" /></svg>
          )}
        </button>
      )}
    </div>
  );
});
