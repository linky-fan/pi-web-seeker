"use client";

import { Fragment, memo, useEffect, useId, useRef, useState } from "react";
import type { ExtensionUiRequest, ExtensionUiResponse } from "@/lib/types";
import type { NoticeItem } from "@/hooks/useAgentSession";
import { normalizeCustomPanelLines, parseAnsiLine, toTerminalKeyData } from "./ansi";
import { areExtensionLayerPropsEqual } from "./memoComparators";
import type { ExtensionWidget } from "./types";

type ExtensionDialogRequest = Extract<ExtensionUiRequest, { method: "select" | "confirm" | "input" | "editor" }>;
type ExtensionCustomRequest = Extract<ExtensionUiRequest, { method: "custom" }>;
type DialogResponse = Omit<ExtensionUiResponse, "type" | "id">;

export interface ExtensionLayerProps {
  statuses: Array<{ key: string; text: string }>;
  notices: NoticeItem[];
  dialog: ExtensionDialogRequest | null;
  customUi: ExtensionCustomRequest | null;
  onRespond: (request: ExtensionDialogRequest, response: DialogResponse) => void;
  onCustomInput: (request: ExtensionCustomRequest, data: string) => void;
}

function extensionStatusTone(text: string): "healthy" | "pending" | "error" {
  if (/\b(?:offline|error|failed|disconnected)\b/i.test(text)) return "error";
  if (/\b(?:connecting|reconnecting|loading)\b/i.test(text)) return "pending";
  return "healthy";
}

function extensionStatusLabel(key: string): string {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (normalized === "pipi") return "Pi Pi";
  if (normalized === "comsnet") return "coms-net";
  return key;
}

function extensionStatusValue(key: string, text: string): string {
  const separator = text.indexOf(":");
  if (separator < 0) return text;
  const prefix = text.slice(0, separator).toLowerCase().replace(/[^a-z0-9]+/g, "");
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return prefix === normalizedKey ? text.slice(separator + 1).trim() || text : text;
}

function ExtensionStatusStrip({ statuses }: { statuses: Array<{ key: string; text: string }> }) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const detailId = useId();
  const expandedStatus = expandedKey === null ? undefined : statuses.find((status) => status.key === expandedKey);

  useEffect(() => {
    if (expandedKey !== null && !expandedStatus) setExpandedKey(null);
  }, [expandedKey, expandedStatus]);

  useEffect(() => {
    if (expandedKey === null) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setExpandedKey(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedKey(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [expandedKey]);

  if (statuses.length === 0) return null;
  return (
    <div ref={rootRef} className="pi-extension-status-strip" aria-label="Extension status" aria-live="polite">
      <div className="pi-extension-status-items">
        {statuses.map((status) => (
          <button
            type="button"
            key={status.key}
            className={`pi-extension-status-chip pi-extension-status-${extensionStatusTone(status.text)}`}
            aria-expanded={expandedKey === status.key}
            aria-controls={expandedKey === status.key ? detailId : undefined}
            title={`${extensionStatusLabel(status.key)}: ${status.text}`}
            onClick={() => setExpandedKey((current) => current === status.key ? null : status.key)}
          >
            <span className="pi-extension-status-dot" aria-hidden="true" />
            <span className="pi-extension-status-label">{extensionStatusLabel(status.key)}</span>
            <span className="pi-extension-status-separator" aria-hidden="true">·</span>
            <span className="pi-extension-status-value">{extensionStatusValue(status.key, status.text)}</span>
          </button>
        ))}
      </div>
      {expandedStatus && (
        <div id={detailId} className="pi-extension-status-detail" role="status">
          <span>{extensionStatusLabel(expandedStatus.key)}</span>
          <strong>{expandedStatus.text}</strong>
        </div>
      )}
    </div>
  );
}

function ExtensionNoticeStack({ notices, hasStatuses }: { notices: NoticeItem[]; hasStatuses: boolean }) {
  if (notices.length === 0) return null;
  return (
    <div className={`pi-extension-notice-stack${hasStatuses ? " pi-extension-notice-stack-offset" : ""}`}>
      {notices.map((notice) => (
        <div
          key={notice.id}
          className="rounded-md border border-border bg-bg-panel px-3 py-2 text-[13px] shadow-lg"
          style={{ color: notice.type === "error" ? "#fca5a5" : notice.type === "warning" ? "#fbbf24" : "var(--text)" }}
        >
          {notice.message}
        </div>
      ))}
    </div>
  );
}

export const ExtensionWidgets = memo(function ExtensionWidgets({ widgets }: { widgets: ExtensionWidget[] }) {
  if (widgets.length === 0) return null;
  return (
    <div className="mx-auto mb-2 flex w-full max-w-[820px] flex-col gap-2 px-4">
      {widgets.map((widget) => (
        <pre key={widget.key} className="m-0 overflow-auto rounded-md border border-border bg-bg-panel px-3 py-2 font-mono text-[12px] leading-[1.45] text-text-muted">
          {widget.lines.join("\n")}
        </pre>
      ))}
    </div>
  );
});

function ExtensionDialog({ request, onRespond }: {
  request: ExtensionDialogRequest;
  onRespond: (request: ExtensionDialogRequest, response: DialogResponse) => void;
}) {
  const [value, setValue] = useState("");
  useEffect(() => setValue(request.method === "editor" ? request.prefill ?? "" : ""), [request]);
  const cancel = () => onRespond(request, { cancelled: true });
  const submitValue = () => onRespond(request, { value });

  return (
    <div className="absolute inset-0 z-[94] flex items-center justify-center bg-[rgba(0,0,0,0.18)] p-5">
      <div className="w-[min(520px,100%)] overflow-hidden rounded-lg border border-border bg-bg shadow-[0_20px_60px_rgba(0,0,0,0.28)]">
        <div className="border-b border-border px-4 py-3 text-[14px] font-semibold text-text">{request.title}</div>
        <div className="p-4">
          {request.method === "select" && (
            <div className="flex flex-col gap-2">
              {request.options.map((option) => (
                <button key={option} type="button" className="rounded-md border border-border bg-bg-panel px-3 py-2 text-left text-[13px] text-text hover:border-accent" onClick={() => onRespond(request, { value: option })}>
                  {option}
                </button>
              ))}
            </div>
          )}
          {request.method === "confirm" && <div className="text-[13px] leading-6 text-text-muted">{request.message}</div>}
          {request.method === "input" && (
            <input autoFocus className="w-full rounded-md border border-border bg-bg-panel px-3 py-2 text-[13px] text-text outline-none focus:border-accent" placeholder={request.placeholder} value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Enter") submitValue();
              if (event.key === "Escape") cancel();
            }} />
          )}
          {request.method === "editor" && (
            <textarea autoFocus className="min-h-[180px] w-full resize-y rounded-md border border-border bg-bg-panel px-3 py-2 font-mono text-[13px] text-text outline-none focus:border-accent" value={value} onChange={(event) => setValue(event.target.value)} onKeyDown={(event) => {
              if (event.key === "Escape") cancel();
            }} />
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" className="rounded-md border border-border bg-bg-panel px-3 py-1.5 text-[12px] text-text-muted hover:text-text" onClick={cancel}>Cancel</button>
          {request.method === "confirm" ? (
            <>
              <button type="button" className="rounded-md border border-border bg-bg-panel px-3 py-1.5 text-[12px] text-text hover:border-accent" onClick={() => onRespond(request, { confirmed: false })}>No</button>
              <button type="button" className="rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] text-white" onClick={() => onRespond(request, { confirmed: true })}>Yes</button>
            </>
          ) : request.method !== "select" ? (
            <button type="button" className="rounded-md border border-accent bg-accent px-3 py-1.5 text-[12px] text-white" onClick={submitValue}>OK</button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ExtensionCustomPanel({ request, onInput }: {
  request: ExtensionCustomRequest;
  onInput: (request: ExtensionCustomRequest, data: string) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const displayLines = normalizeCustomPanelLines(request.lines);
  useEffect(() => panelRef.current?.focus(), [request.id]);
  return (
    <div className="absolute inset-0 z-[95] flex items-center justify-center bg-[rgba(0,0,0,0.18)] p-5">
      <div ref={panelRef} tabIndex={0} role="dialog" aria-modal="true" className="w-[min(920px,100%)] overflow-hidden rounded-lg border border-border bg-bg shadow-[0_20px_60px_rgba(0,0,0,0.28)] outline-none" style={{ maxHeight: "min(760px, calc(100vh - 40px))" }} onKeyDown={(event) => {
        const data = toTerminalKeyData(event);
        if (!data) return;
        event.preventDefault();
        event.stopPropagation();
        onInput(request, data);
      }}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
          <div className="text-[13px] font-semibold text-text">Extension panel</div>
          <button type="button" className="rounded-md border border-border bg-bg-panel px-2.5 py-1 text-[12px] text-text-muted hover:text-text" onClick={() => onInput(request, "\x03")}>Close</button>
        </div>
        <pre className="m-0 overflow-auto bg-bg-panel p-3 font-mono text-[13px] leading-[1.45] text-text" style={{ maxHeight: "calc(min(760px, 100vh - 40px) - 48px)", whiteSpace: "pre" }}>
          {(displayLines.length ? displayLines : [""]).map((line, lineIndex, allLines) => (
            <Fragment key={lineIndex}>
              {parseAnsiLine(line).map((segment, segmentIndex) => Object.keys(segment.style).length > 0
                ? <span key={`${lineIndex}-${segmentIndex}`} style={segment.style}>{segment.text}</span>
                : segment.text)}
              {lineIndex < allLines.length - 1 ? "\n" : null}
            </Fragment>
          ))}
        </pre>
      </div>
    </div>
  );
}

export const ExtensionLayer = memo(function ExtensionLayer({ statuses, notices, dialog, customUi, onRespond, onCustomInput }: ExtensionLayerProps) {
  return (
    <>
      <ExtensionStatusStrip statuses={statuses} />
      <ExtensionNoticeStack notices={notices} hasStatuses={statuses.length > 0} />
      {dialog && <ExtensionDialog request={dialog} onRespond={onRespond} />}
      {customUi && <ExtensionCustomPanel request={customUi} onInput={onCustomInput} />}
    </>
  );
}, areExtensionLayerPropsEqual);
