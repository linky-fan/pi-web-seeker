"use client";

import { memo, useState } from "react";
import { useLocale } from "@/lib/i18n";
import type { ThinkingContent } from "@/lib/types";

function ThinkingBlockImpl({ block, duration }: { block: ThinkingContent; duration?: number }) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState(false);
  const hasThinking = block.thinking.trim().length > 0;
  return (
    <div
      className="pi-thinking-card"
      style={{
        position: "relative",
        border: "1px solid color-mix(in srgb, var(--accent) 22%, var(--border))",
        borderRadius: 9,
        overflow: "hidden",
        fontSize: 13,
        background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 8%, var(--bg-panel)) 0%, var(--bg-panel) 52%, var(--bg) 100%)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.05)",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: "0 auto 0 0",
          width: 3,
          background: "linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 18%, transparent))",
        }}
      />
      <button
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          width: "100%",
          padding: "9px 12px 9px 14px",
          background: "transparent",
          border: "none",
          color: "var(--text)",
          cursor: "pointer",
          fontSize: 12.5,
          textAlign: "left",
          fontWeight: 650,
          letterSpacing: 0,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 18,
            height: 18,
            borderRadius: 999,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            color: "var(--accent)",
            background: "color-mix(in srgb, var(--accent) 13%, transparent)",
            boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--accent) 22%, transparent)",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              background: "currentColor",
              boxShadow: "0 0 10px currentColor",
            }}
          />
        </span>
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 1 }}>
          <span>{t("message.thinking")}</span>
          {!expanded && hasThinking && (
            <span
              style={{
                color: "var(--text-dim)",
                fontSize: 11,
                fontWeight: 400,
                lineHeight: 1.35,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                maxWidth: "min(560px, 72vw)",
              }}
            >
              {block.thinking.replace(/\s+/g, " ").trim()}
            </span>
          )}
        </span>
        {duration !== undefined && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 11,
              color: "var(--accent)",
              fontVariantNumeric: "tabular-nums",
              background: "color-mix(in srgb, var(--accent) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--accent) 18%, transparent)",
              borderRadius: 999,
              padding: "2px 7px",
              lineHeight: 1.3,
              flexShrink: 0,
            }}
          >
            {duration}s
          </span>
        )}
        <svg
          aria-hidden="true"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{
            color: "var(--text-dim)",
            flexShrink: 0,
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.14s ease",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {expanded && (
        <div
          style={{
            margin: "0 10px 10px 14px",
            padding: "10px 12px",
            color: "var(--text-muted)",
            fontSize: 12,
            lineHeight: 1.65,
            whiteSpace: "pre-wrap",
            background: "color-mix(in srgb, var(--bg) 78%, var(--bg-panel))",
            border: "1px solid color-mix(in srgb, var(--accent) 12%, var(--border))",
            borderRadius: 7,
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
            maxHeight: 320,
            overflow: "auto",
          }}
        >
          {block.thinking}
        </div>
      )}
    </div>
  );
}


export const ThinkingBlock = memo(ThinkingBlockImpl, (previous, next) =>
  previous.block.thinking === next.block.thinking && previous.duration === next.duration,
);
