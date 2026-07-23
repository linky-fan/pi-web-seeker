"use client";

import { memo } from "react";
import type { ComposerSuggestionsController } from "./useComposerSuggestionsController";
import type { Translate } from "./types";

interface Props {
  controller: ComposerSuggestionsController;
  isStreaming: boolean;
  t: Translate;
}

export const ComposerSuggestions = memo(function ComposerSuggestions({ controller, isStreaming, t }: Props) {
  return (
    <>
      {controller.slashOpen && (
        <div
          ref={controller.slashPanelRef}
          className="pi-popover pi-slash-popover"
          role="listbox"
          aria-label={t("chat.slash.title")}
          tabIndex={-1}
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
          style={{
            position: "absolute", left: 10, bottom: "calc(100% + 8px)", zIndex: 320,
            width: "min(520px, calc(100vw - 56px))", maxHeight: "min(420px, calc(100dvh - 180px))",
            overflowY: "auto", overscrollBehavior: "contain", touchAction: "pan-y", WebkitOverflowScrolling: "touch",
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10,
            boxShadow: "0 -8px 24px rgba(15,23,42,0.16)", padding: 4,
          }}
        >
          <div style={{ position: "sticky", top: 0, zIndex: 1, padding: "7px 9px 6px", fontSize: 11, color: "var(--text-dim)", fontWeight: 650, background: "var(--bg)" }}>
            {t("chat.slash.title")}
          </div>
          {controller.slashCommands.length === 0 ? (
            <div style={{ padding: 9, color: "var(--text-dim)", fontSize: 12 }}>{t("chat.slash.empty")}</div>
          ) : controller.slashCommands.map((command, index) => {
            const active = index === controller.slashSelectedIndex;
            const disabled = isStreaming || command.disabled;
            return (
              <button
                key={command.name}
                data-slash-index={index}
                type="button"
                role="option"
                aria-selected={active}
                disabled={disabled}
                onMouseEnter={() => controller.setSlashSelectedIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  void controller.runSlashCommand(command);
                }}
                style={{
                  display: "grid", gridTemplateColumns: "18px minmax(0, 1fr) auto", alignItems: "center", gap: 7,
                  width: "100%", minHeight: 34, padding: "6px 9px", background: active ? "var(--bg-selected)" : "none",
                  border: "none", borderRadius: 7, color: disabled ? "var(--text-dim)" : active ? "var(--text)" : "var(--text-muted)",
                  cursor: disabled ? "not-allowed" : "pointer", textAlign: "left", fontSize: 12, opacity: disabled ? 0.62 : 1,
                }}
              >
                <span style={{ color: command.mode === "plan" ? "rgba(234,179,8,0.98)" : "var(--accent)", display: "flex" }}>
                  {command.mode === "plan" ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M9 11h6" /><path d="M9 15h4" /><path d="M5 4h14v16H5z" /><path d="M8 4V2" /><path d="M16 4V2" />
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M4 12h16" /><path d="M12 4v16" />
                    </svg>
                  )}
                </span>
                <span style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 7, overflow: "hidden", whiteSpace: "nowrap" }}>
                  <span style={{ flexShrink: 0, color: active ? "var(--text)" : "var(--text-muted)", fontWeight: 650 }}>/{command.name}</span>
                  <span aria-hidden="true" style={{ flexShrink: 0, width: 2, height: 2, borderRadius: "50%", background: "var(--text-dim)", opacity: 0.7 }} />
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 11 }}>{command.description}</span>
                </span>
                {command.active && <span style={{ color: "var(--accent)", fontSize: 11, fontWeight: 650 }}>{t("chat.slash.active")}</span>}
              </button>
            );
          })}
          {controller.slashNotice && <div style={{ padding: "7px 9px 4px", color: "rgba(234,179,8,0.98)", fontSize: 11 }}>{controller.slashNotice}</div>}
        </div>
      )}
      {controller.mentionOpen && (
        <div
          ref={controller.mentionPanelRef}
          className="pi-popover pi-mention-popover"
          role="listbox"
          aria-label={t("chat.fileMentionsTitle")}
          tabIndex={-1}
          onWheel={(event) => event.stopPropagation()}
          onTouchMove={(event) => event.stopPropagation()}
          style={{
            position: "absolute", left: 10, bottom: "calc(100% + 8px)", zIndex: 300,
            width: "min(420px, calc(100vw - 56px))", maxHeight: "min(360px, calc(100vh - 220px))",
            overflowY: "auto", overscrollBehavior: "contain", touchAction: "pan-y", WebkitOverflowScrolling: "touch",
            background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10,
            boxShadow: "0 -8px 24px rgba(15,23,42,0.16)", padding: 4,
          }}
        >
          {controller.mentionLoading && controller.mentionEntries.length === 0 ? (
            <div style={{ padding: "10px 12px", color: "var(--text-dim)", fontSize: 12 }}>{t("chat.fileMentionsLoading")}</div>
          ) : controller.mentionEntries.length === 0 ? (
            <div style={{ padding: "10px 12px", color: "var(--text-dim)", fontSize: 12 }}>{t("chat.fileMentionsEmpty")}</div>
          ) : controller.mentionEntries.map((entry, index) => {
            const active = index === controller.mentionSelectedIndex;
            return (
              <button
                key={`${entry.isDir ? "dir" : "file"}:${entry.path}`}
                type="button"
                role="option"
                aria-selected={active}
                onMouseEnter={() => controller.setMentionSelectedIndex(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  controller.insertMention(entry);
                }}
                style={{
                  display: "grid", gridTemplateColumns: "18px minmax(0, 1fr)", alignItems: "center", gap: 8,
                  width: "100%", padding: "7px 9px", background: active ? "var(--bg-selected)" : "none",
                  border: "none", borderRadius: 7, color: active ? "var(--text)" : "var(--text-muted)", cursor: "pointer", textAlign: "left", fontSize: 12,
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ color: entry.isDir ? "var(--accent)" : "var(--text-dim)" }}>
                  {entry.isDir ? <><path d="M3 7h6l2 2h10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M3 7V5a2 2 0 0 1 2-2h4l2 2h3" /></>
                    : <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></>}
                </svg>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.path}{entry.isDir ? "/" : ""}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
});
