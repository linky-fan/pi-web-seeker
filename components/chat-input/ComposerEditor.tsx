"use client";

import { memo, type ClipboardEvent, type KeyboardEvent, type RefObject } from "react";
import { popOnce } from "@/lib/motion";
import { ComposerSuggestions } from "./ComposerSuggestions";
import type { ComposerSuggestionsController } from "./useComposerSuggestionsController";
import type { Translate } from "./types";

interface Props {
  inputShellRef: RefObject<HTMLDivElement | null>;
  sendButtonRef: RefObject<HTMLButtonElement | null>;
  streamActionsRef: RefObject<HTMLDivElement | null>;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  suggestions: ComposerSuggestionsController;
  value: string;
  canSend: boolean;
  isStreaming: boolean;
  canSteer: boolean;
  canFollowUp: boolean;
  onFocusChange: (focused: boolean) => void;
  onValueChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onInput: () => void;
  onPaste: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onSendQueued: (mode: "steer" | "followup") => void;
  t: Translate;
}

export const ComposerEditor = memo(function ComposerEditor(props: Props) {
  const queued = props.isStreaming && (props.canSteer || props.canFollowUp);
  return (
    <div
      ref={props.inputShellRef}
      className="pi-command-surface"
      style={{
        position: "relative", display: "flex", gap: 8, alignItems: "center", background: "var(--bg)",
        border: `1px solid ${queued ? "rgba(234,179,8,0.4)" : "color-mix(in srgb, var(--border) 70%, transparent)"}`,
        borderRadius: 14, padding: "10px 10px 10px 14px",
        boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10)",
        transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
      }}
    >
      <ComposerSuggestions controller={props.suggestions} isStreaming={props.isStreaming} t={props.t} />
      <textarea
        className="pi-command-textarea"
        ref={props.textareaRef}
        value={props.value}
        onFocus={() => props.onFocusChange(true)}
        onBlur={() => props.onFocusChange(false)}
        onChange={(event) => props.onValueChange(event.target.value)}
        onKeyDown={props.onKeyDown}
        onInput={props.onInput}
        onClick={(event) => {
          props.suggestions.updateSlashState(event.currentTarget.value, event.currentTarget.selectionStart);
          props.suggestions.updateMentionState(event.currentTarget.value, event.currentTarget.selectionStart);
        }}
        onSelect={(event) => {
          props.suggestions.updateSlashState(event.currentTarget.value, event.currentTarget.selectionStart);
          props.suggestions.updateMentionState(event.currentTarget.value, event.currentTarget.selectionStart);
        }}
        onPaste={props.onPaste}
        placeholder={queued ? props.t("chat.placeholder.streamingQueued") : props.isStreaming ? props.t("chat.placeholder.running") : props.t("chat.placeholder.message")}
        rows={1}
        style={{
          flex: 1, background: "none", border: "none", outline: "none", resize: "none", color: "var(--text)",
          fontSize: 14, lineHeight: 1.6, fontFamily: "inherit", minHeight: 24, maxHeight: 200, overflow: "auto",
        }}
      />
      {props.isStreaming ? (
        <div ref={props.streamActionsRef} className="pi-stream-actions" style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, alignSelf: "flex-end" }}>
          {props.canSteer && (
            <button
              className="pi-send-command pi-send-command-queued"
              onClick={() => props.onSendQueued("steer")}
              disabled={!props.canSend}
              title={props.t("chat.steerTitle")}
              style={{
                display: "flex", alignItems: "center", gap: 5, padding: "7px 12px",
                background: props.canSend ? "rgba(234,179,8,0.12)" : "none",
                border: "1px solid rgba(234,179,8,0.35)", borderRadius: 8,
                color: props.canSend ? "rgba(180,130,0,1)" : "var(--text-dim)", cursor: props.canSend ? "pointer" : "not-allowed",
                fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em", transition: "background 0.12s",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 1 L9 5 L5 9" /><line x1="1" y1="5" x2="9" y2="5" />
              </svg>
              <span className="pi-send-command-label">{props.t("chat.steer")}</span>
            </button>
          )}
          {props.canFollowUp && (
            <button
              className="pi-send-command pi-send-command-queued"
              onClick={() => props.onSendQueued("followup")}
              disabled={!props.canSend}
              title={props.t("chat.followUpTitle")}
              style={{
                display: "flex", alignItems: "center", gap: 5, padding: "7px 12px",
                background: props.canSend ? "rgba(129,140,248,0.12)" : "none",
                border: "1px solid rgba(129,140,248,0.35)", borderRadius: 8,
                color: props.canSend ? "rgba(99,102,241,1)" : "var(--text-dim)", cursor: props.canSend ? "pointer" : "not-allowed",
                fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em", transition: "background 0.12s",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <line x1="5" y1="1" x2="5" y2="6" /><polyline points="2.5 3.5 5 1 7.5 3.5" /><line x1="2" y1="9" x2="8" y2="9" />
              </svg>
              <span className="pi-send-command-label">{props.t("chat.followUp")}</span>
            </button>
          )}
        </div>
      ) : (
        <button
          className="pi-send-command"
          ref={props.sendButtonRef}
          onClick={() => {
            if (props.canSend) popOnce(props.sendButtonRef.current);
            props.onSend();
          }}
          disabled={!props.canSend}
          style={{
            flexShrink: 0, alignSelf: "flex-end", display: "flex", alignItems: "center", gap: 6, padding: "7px 14px",
            background: props.canSend ? "var(--accent)" : "var(--bg-panel)", border: "none", borderRadius: 8,
            color: props.canSend ? "#fff" : "var(--text-dim)", cursor: props.canSend ? "pointer" : "not-allowed",
            fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em",
            boxShadow: props.canSend ? "0 1px 3px rgba(37,99,235,0.25)" : "none",
            transition: "background 0.15s, box-shadow 0.15s, color 0.15s",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="2" y1="7" x2="11" y2="7" /><polyline points="7.5 3 12 7 7.5 11" />
          </svg>
          {props.t("chat.send")}
        </button>
      )}
    </div>
  );
});
