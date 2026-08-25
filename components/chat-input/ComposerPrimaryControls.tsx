"use client";

import { memo } from "react";
import { createPortal } from "react-dom";
import type { BuddyMode, ModelRef, PlanExecutionMode, PlanMode } from "@/lib/plan-mode";
import { getBuddyReviewerControlPresentation, PROMPT_SNIPPETS, shouldShowBuddyReviewerControl } from "./helpers";
import type { ModelGroup, ModelOption, Translate } from "./types";
import type { ComposerMenusController } from "./useComposerMenusController";

interface Props {
  imageInputId: string;
  attachmentCount: number;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  modelOptions: ModelOption[];
  modelGroups: ModelGroup[];
  currentName: string | null;
  onModelChange?: (provider: string, modelId: string) => void;
  buddyMode: BuddyMode;
  subagentsEnabled: boolean;
  planMode: PlanMode;
  planExecutionMode: PlanExecutionMode;
  onPlanModeChange?: (mode: PlanMode, executionMode?: PlanExecutionMode) => boolean | Promise<boolean>;
  onBuddyModeChange?: (mode: BuddyMode) => boolean | Promise<boolean>;
  onSubagentsModeChange?: (enabled: boolean) => boolean | Promise<boolean>;
  buddyReviewerModel?: ModelRef | null;
  reviewerName: string | null;
  onBuddyReviewerChange?: (provider: string, modelId: string) => boolean | Promise<boolean>;
  onInsertSnippet: (text: string) => void;
  menus: ComposerMenusController;
  t: Translate;
}

export const ComposerPrimaryControls = memo(function ComposerPrimaryControls(props: Props) {
  const { menus } = props;
  const reviewerControl = getBuddyReviewerControlPresentation(props.buddyMode, props.reviewerName, props.t);
  return (
    <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", rowGap: 4 }}>
      {(props.planMode === "plan" || props.buddyMode !== "off" || props.subagentsEnabled) && (
        <button
          type="button"
          data-motion-control
          onClick={() => {
            if (props.isStreaming) return;
            if (props.subagentsEnabled) void props.onSubagentsModeChange?.(false);
            else if (props.buddyMode !== "off") void props.onBuddyModeChange?.("off");
            else void props.onPlanModeChange?.("normal");
          }}
          disabled={props.isStreaming}
          title={props.subagentsEnabled
            ? props.t("chat.subagentsModeExit")
            : props.buddyMode !== "off"
            ? props.t("chat.buddyExit")
            : props.planExecutionMode === "subagent" ? props.t("chat.planModeSubagentHint") : props.t("chat.planModeExit")}
          style={{
            flexShrink: 0, display: "flex", alignItems: "center", gap: 5, height: 32, padding: "0 9px",
            background: "rgba(234,179,8,0.10)", border: "1px solid rgba(234,179,8,0.30)", borderRadius: 8,
            color: "rgba(180,130,0,1)", cursor: props.isStreaming ? "not-allowed" : "pointer",
            opacity: props.isStreaming ? 0.64 : 1, fontSize: 11, fontWeight: 700, whiteSpace: "nowrap",
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11h6" /><path d="M9 15h4" /><path d="M5 4h14v16H5z" /><path d="M8 4V2" /><path d="M16 4V2" />
          </svg>
          <span>{props.subagentsEnabled
            ? props.t("chat.subagentsMode")
            : props.buddyMode === "plan"
            ? props.t("chat.buddyPlan")
            : props.buddyMode === "code"
              ? props.t("chat.buddyCode")
              : props.planExecutionMode === "subagent"
                ? props.t("chat.planModeSubagent")
                : props.t("chat.planMode")}</span>
        </button>
      )}
      <label
        data-motion-control
        htmlFor={props.imageInputId}
        role="button"
        aria-label={props.t("chat.attachImage")}
        tabIndex={0}
        title={props.t("chat.attachImage")}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            document.getElementById(props.imageInputId)?.click();
          }
        }}
        style={{
          flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
          height: 32, padding: "0 8px", background: props.attachmentCount ? "var(--bg-selected)" : "var(--bg-panel)",
          border: "1px solid var(--border)", borderRadius: 8, color: props.attachmentCount ? "var(--accent)" : "var(--text-muted)",
          cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
          transition: "background 0.12s, color 0.12s, border-color 0.12s",
        }}
        onMouseEnter={(event) => {
          event.currentTarget.style.background = "var(--bg-hover)";
          event.currentTarget.style.color = props.attachmentCount ? "var(--accent)" : "var(--text)";
          event.currentTarget.style.borderColor = "var(--accent)";
        }}
        onMouseLeave={(event) => {
          event.currentTarget.style.background = props.attachmentCount ? "var(--bg-selected)" : "var(--bg-panel)";
          event.currentTarget.style.color = props.attachmentCount ? "var(--accent)" : "var(--text-muted)";
          event.currentTarget.style.borderColor = "var(--border)";
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
        </svg>
        <span style={{ lineHeight: 1 }}>{props.t("chat.attachImageShort")}</span>
        {props.attachmentCount > 0 && (
          <span style={{ minWidth: 15, height: 15, padding: "0 4px", borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--accent)", color: "#fff", fontSize: 10, fontWeight: 700, lineHeight: 1 }}>
            {props.attachmentCount}
          </span>
        )}
      </label>

      <div ref={menus.snippetDropdownRef} style={{ position: "relative", flexShrink: 0 }}>
        <button
          data-motion-control
          onClick={() => menus.setSnippetDropdownOpen((open) => !open)}
          title={props.t("chat.promptSnippetsTitle")}
          aria-label={props.t("chat.promptSnippetsTitle")}
          aria-haspopup="menu"
          aria-expanded={menus.snippetDropdownOpen}
          style={{
            flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
            height: 32, padding: "0 9px", background: menus.snippetDropdownOpen ? "var(--bg-hover)" : "var(--bg-panel)",
            border: "1px solid var(--border)", borderRadius: 8, color: menus.snippetDropdownOpen ? "var(--accent)" : "var(--text-muted)",
            cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", transition: "background 0.12s, color 0.12s, border-color 0.12s",
          }}
          onMouseEnter={(event) => {
            event.currentTarget.style.background = "var(--bg-hover)";
            event.currentTarget.style.color = "var(--text)";
            event.currentTarget.style.borderColor = "var(--accent)";
          }}
          onMouseLeave={(event) => {
            event.currentTarget.style.background = menus.snippetDropdownOpen ? "var(--bg-hover)" : "var(--bg-panel)";
            event.currentTarget.style.color = menus.snippetDropdownOpen ? "var(--accent)" : "var(--text-muted)";
            event.currentTarget.style.borderColor = "var(--border)";
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 6h16" /><path d="M4 12h10" /><path d="M4 18h7" /><path d="M17 14l3 3-3 3" />
          </svg>
          <span style={{ lineHeight: 1 }}>{props.t("chat.promptSnippetsShort")}</span>
        </button>
        {menus.snippetDropdownOpen && (
          <div ref={menus.snippetDropdownPanelRef} className="pi-popover pi-snippet-popover" role="menu" style={{
            position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 100, background: "var(--bg)",
            border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
            overflow: "hidden", minWidth: 260, maxWidth: "calc(100vw - 32px)",
          }}>
            {PROMPT_SNIPPETS.map((snippet) => (
              <button
                key={snippet.labelKey}
                role="menuitem"
                onClick={() => {
                  menus.setSnippetDropdownOpen(false);
                  props.onInsertSnippet(snippet.text);
                }}
                style={{ display: "grid", gridTemplateColumns: "72px minmax(0, 1fr)", gap: 8, width: "100%", padding: "8px 12px", background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12, textAlign: "left" }}
                onMouseEnter={(event) => {
                  event.currentTarget.style.background = "var(--bg-hover)";
                  event.currentTarget.style.color = "var(--text)";
                }}
                onMouseLeave={(event) => {
                  event.currentTarget.style.background = "none";
                  event.currentTarget.style.color = "var(--text-muted)";
                }}
              >
                <span style={{ color: "var(--text)", fontWeight: 600 }}>{props.t(snippet.labelKey)}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{snippet.text}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {props.modelOptions.length > 0 && props.currentName && props.onModelChange && (
        <div ref={menus.dropdownRef} data-motion-control style={{ position: "relative" }}>
          <button
            ref={menus.modelButtonRef}
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              menus.setModelDropdownRect({ top: rect.top, left: rect.left, width: rect.width });
              menus.setModelDropdownOpen((open) => !open);
            }}
            disabled={props.isStreaming}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", height: 32, maxWidth: 220, overflow: "hidden",
              background: menus.modelDropdownOpen ? "var(--bg-hover)" : "none", border: "none", borderRadius: 9,
              color: "var(--text-muted)", cursor: props.isStreaming ? "not-allowed" : "pointer", fontSize: 12,
              opacity: props.isStreaming ? 0.5 : 1, transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(event) => {
              if (props.isStreaming) return;
              event.currentTarget.style.background = "var(--bg-hover)";
              event.currentTarget.style.color = "var(--text)";
            }}
            onMouseLeave={(event) => {
              event.currentTarget.style.background = menus.modelDropdownOpen ? "var(--bg-hover)" : "none";
              event.currentTarget.style.color = "var(--text-muted)";
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
              <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
              <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
              <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
              <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
            </svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{props.currentName}</span>
          </button>
          {menus.modelDropdownOpen && menus.modelDropdownRect && typeof document !== "undefined" && createPortal((() => {
            const margin = 8;
            const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
            const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
            const viewportMaxWidth = Math.max(120, viewportWidth - margin * 2);
            const initialMinWidth = Math.min(menus.modelDropdownRect.width, viewportMaxWidth);
            const left = Math.min(Math.max(margin, menus.modelDropdownRect.left), Math.max(margin, viewportWidth - initialMinWidth - margin));
            const maxPanelWidth = Math.max(120, viewportWidth - left - margin);
            const minPanelWidth = Math.min(menus.modelDropdownRect.width, maxPanelWidth);
            const bottom = viewportHeight - menus.modelDropdownRect.top + 6;
            const maxHeight = Math.max(120, Math.min(menus.modelDropdownRect.top - 8, viewportHeight * 0.6));
            return (
              <div ref={menus.modelDropdownPanelRef} className="pi-popover pi-model-popover" style={{
                position: "fixed", bottom, left, zIndex: 500, background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)", overflow: "hidden",
                width: "max-content", minWidth: minPanelWidth, maxWidth: maxPanelWidth, maxHeight, overflowY: "auto",
              }}>
                {props.modelGroups.map((group, groupIndex) => (
                  <div key={group.provider}>
                    {props.modelGroups.length > 1 && <div style={{ padding: "6px 12px 4px", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em", borderTop: groupIndex > 0 ? "1px solid var(--border)" : "none" }}>{group.provider}</div>}
                    {group.options.map((option) => {
                      const active = option.modelId === props.model?.modelId && option.provider === props.model?.provider;
                      return (
                        <button key={`${option.provider}:${option.modelId}`} onClick={() => {
                          menus.setModelDropdownOpen(false);
                          if (!active) props.onModelChange?.(option.provider, option.modelId);
                        }} style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 12px", background: active ? "var(--bg-selected)" : "none", border: "none", color: active ? "var(--text)" : "var(--text-muted)", cursor: "pointer", fontSize: 12, textAlign: "left", fontWeight: active ? 600 : 400, whiteSpace: "nowrap" }}
                        onMouseEnter={(event) => { if (!active) event.currentTarget.style.background = "var(--bg-hover)"; }}
                        onMouseLeave={(event) => { if (!active) event.currentTarget.style.background = "none"; }}>
                          {active ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg> : <span style={{ width: 10, flexShrink: 0 }} />}
                          {option.name}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })(), document.body)}
        </div>
      )}

      {shouldShowBuddyReviewerControl(props.modelOptions.length, Boolean(props.onBuddyReviewerChange)) && (
        <div ref={menus.reviewerDropdownRef} data-motion-control style={{ position: "relative", flexShrink: 0 }}>
          <button
            type="button" aria-haspopup="menu" aria-expanded={menus.reviewerDropdownOpen} disabled={props.isStreaming}
            onClick={() => menus.setReviewerDropdownOpen((open) => !open)} title={reviewerControl.title}
            style={{
              height: 32, maxWidth: 210, display: "flex", alignItems: "center", gap: 6, padding: "0 9px",
              background: menus.reviewerDropdownOpen ? "var(--bg-hover)" : "var(--bg-panel)",
              border: `1px solid ${props.buddyMode !== "off" ? "rgba(234,179,8,0.28)" : "var(--border)"}`,
              borderRadius: 8, color: props.buddyMode !== "off" ? "rgba(180,130,0,1)" : "var(--text-muted)",
              cursor: props.isStreaming ? "not-allowed" : "pointer", opacity: props.isStreaming ? 0.55 : 1,
              fontSize: 11, fontWeight: 650, whiteSpace: "nowrap", transition: "background 0.12s, color 0.12s, border-color 0.12s",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M12 3l7 3v5c0 4.6-2.8 8-7 10-4.2-2-7-5.4-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{reviewerControl.label}</span>
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ flexShrink: 0, opacity: 0.7 }}><path d="M2 3.5L5 6.5L8 3.5" /></svg>
          </button>
          {menus.reviewerDropdownOpen && (
            <div ref={menus.reviewerDropdownPanelRef} className="pi-popover pi-model-popover" role="menu" style={{
              position: "absolute", bottom: "calc(100% + 6px)", left: 0, zIndex: 500, minWidth: 240,
              maxWidth: "min(340px, calc(100vw - 32px))", maxHeight: "min(420px, 60vh)", overflowY: "auto",
              background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 9,
              boxShadow: "0 -6px 20px rgba(15,23,42,0.12)", padding: 4,
            }}>
              <div style={{ padding: "7px 9px 6px", color: "var(--text-dim)", fontSize: 10, fontWeight: 650, letterSpacing: "0.04em" }}>{reviewerControl.hint}</div>
              {props.modelGroups.map((group) => (
                <div key={group.provider}>
                  {props.modelGroups.length > 1 && <div style={{ padding: "6px 9px 3px", color: "var(--text-dim)", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em" }}>{group.provider}</div>}
                  {group.options.map((option) => {
                    const active = option.provider === props.buddyReviewerModel?.provider && option.modelId === props.buddyReviewerModel.modelId;
                    const conflicts = option.provider === props.model?.provider && option.modelId === props.model.modelId;
                    return (
                      <button key={`${option.provider}:${option.modelId}`} type="button" role="menuitem" disabled={conflicts} onClick={() => {
                        if (conflicts) return;
                        menus.setReviewerDropdownOpen(false);
                        if (!active) void props.onBuddyReviewerChange?.(option.provider, option.modelId);
                      }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 9px", background: active ? "var(--bg-selected)" : "none", border: "none", borderRadius: 6, color: conflicts ? "var(--text-dim)" : active ? "var(--text)" : "var(--text-muted)", cursor: conflicts ? "not-allowed" : "pointer", opacity: conflicts ? 0.5 : 1, fontSize: 12, textAlign: "left", whiteSpace: "nowrap" }}>
                        {active ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg> : <span style={{ width: 10, flexShrink: 0 }} />}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{option.name}</span>
                        {conflicts && <span style={{ marginLeft: "auto", fontSize: 10 }}>{props.t("chat.buddySameModel")}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
