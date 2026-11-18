"use client";

import { useMemo, useState } from "react";
import { useLocale } from "@/lib/i18n";
import {
  diffStats,
  parseUnifiedDiff,
  relativeChangePath,
  type FileChange,
} from "@/lib/file-changes";

export function ChangesPanel({
  changes,
  cwd,
  onOpenFile,
}: {
  changes: FileChange[];
  cwd: string | null;
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useLocale();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (path: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const totals = useMemo(
    () => changes.reduce(
      (sum, change) => {
        const stats = diffStats(change.diff);
        return { added: sum.added + stats.added, removed: sum.removed + stats.removed };
      },
      { added: 0, removed: 0 },
    ),
    [changes],
  );

  if (changes.length === 0) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12, padding: 24, textAlign: "center" }}>
        {t("changes.empty")}
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel-paint)", fontSize: 11, flexShrink: 0 }}>
        <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>
          {t("changes.fileCount", { count: changes.length })}
        </span>
        <span style={{ color: "#16a34a", fontFamily: "var(--font-mono)" }}>+{totals.added}</span>
        <span style={{ color: "#dc2626", fontFamily: "var(--font-mono)" }}>-{totals.removed}</span>
      </div>

      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {changes.map((change) => (
          <ChangeRow
            key={change.path}
            change={change}
            cwd={cwd}
            expanded={expanded.has(change.path)}
            onToggle={() => toggle(change.path)}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    </div>
  );
}

function ChangeRow({
  change,
  cwd,
  expanded,
  onToggle,
  onOpenFile,
}: {
  change: FileChange;
  cwd: string | null;
  expanded: boolean;
  onToggle: () => void;
  onOpenFile?: (filePath: string) => void;
}) {
  const { t } = useLocale();
  const label = relativeChangePath(change.path, cwd);
  const stats = diffStats(change.diff);
  const lines = expanded ? parseUnifiedDiff(change.diff) : [];

  return (
    <div style={{ borderBottom: "1px solid var(--border)" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 12px",
          cursor: change.diff ? "pointer" : "default",
          fontSize: 12,
        }}
        onClick={() => { if (change.diff) onToggle(); }}
      >
        <svg
          width="10" height="10" viewBox="0 0 10 10"
          fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s", opacity: change.diff ? 1 : 0.3 }}
        >
          <polyline points="2 3.5 5 6.5 8 3.5" />
        </svg>
        <span style={{
          flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontFamily: "var(--font-mono)", fontSize: 11.5,
          color: change.isError ? "#f87171" : "var(--text)",
        }}>
          {label}
        </span>
        {change.entries.length > 1 && (
          <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>
            ×{change.entries.length}
          </span>
        )}
        {change.diff ? (
          <>
            <span style={{ color: "#16a34a", fontFamily: "var(--font-mono)", fontSize: 10.5, flexShrink: 0 }}>+{stats.added}</span>
            <span style={{ color: "#dc2626", fontFamily: "var(--font-mono)", fontSize: 10.5, flexShrink: 0 }}>-{stats.removed}</span>
          </>
        ) : (
          <span style={{ fontSize: 10, color: "#f59e0b", flexShrink: 0 }}>{t("changes.failed")}</span>
        )}
        {onOpenFile && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onOpenFile(change.path); }}
            title={t("changes.openFile")}
            style={{ flexShrink: 0, padding: "1px 6px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer", fontSize: 10 }}
          >
            {t("changes.open")}
          </button>
        )}
      </div>

      {expanded && lines.length > 0 && (
        <pre style={{
          margin: 0,
          maxHeight: 420,
          overflow: "auto",
          background: "var(--bg-subtle)",
          borderTop: "1px solid var(--border)",
          fontSize: 11,
          lineHeight: 1.55,
          fontFamily: "var(--font-mono)",
        }}>
          {lines.map((line, index) => (
            <div
              key={index}
              style={{
                padding: "0 12px",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                background: line.type === "add" ? "rgba(34,197,94,0.10)" : line.type === "remove" ? "rgba(239,68,68,0.10)" : "transparent",
                color: line.type === "add" ? "#15803d" : line.type === "remove" ? "#b91c1c" : "var(--text-dim)",
              }}
            >
              {line.type === "add" ? "+" : line.type === "remove" ? "-" : " "}{line.text}
            </div>
          ))}
        </pre>
      )}
    </div>
  );
}