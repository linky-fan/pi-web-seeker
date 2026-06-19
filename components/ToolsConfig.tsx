"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useLocale } from "@/lib/i18n";
import { apiPath } from "@/lib/api-path";
import { MotionModal } from "./MotionModal";

interface ToolToggleEntry {
  name: string;
  description: string;
  active: boolean;
}

interface Props {
  cwd: string | null;
  onClose: () => void;
  closeSignal?: unknown;
}

const BUILTIN_TOOL_NAMES = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"]);

export function ToolsConfig({ cwd, onClose, closeSignal }: Props) {
  const { t } = useLocale();
  const [tools, setTools] = useState<ToolToggleEntry[]>([]);
  const [active, setActive] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const query = cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
    fetch(apiPath(`tools${query}`))
      .then((res) => res.json() as Promise<{ tools?: ToolToggleEntry[]; error?: string }>)
      .then((data) => {
        if (cancelled) return;
        if (data.error) throw new Error(data.error);
        const nextTools = data.tools ?? [];
        setTools(nextTools);
        setActive(new Set(nextTools.filter((tool) => tool.active).map((tool) => tool.name)));
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const builtinTools = useMemo(() => tools.filter((tool) => BUILTIN_TOOL_NAMES.has(tool.name)), [tools]);
  const extensionTools = useMemo(() => tools.filter((tool) => !BUILTIN_TOOL_NAMES.has(tool.name)), [tools]);

  const toggle = useCallback((name: string) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const setAll = useCallback((enabled: boolean) => {
    setActive(enabled ? new Set(tools.map((tool) => tool.name)) : new Set());
  }, [tools]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(apiPath("tools"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activeTools: Array.from(active) }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setSaving(false);
    }
  }, [active]);

  return (
    <MotionModal
      onClose={onClose}
      closeSignal={closeSignal}
      panelStyle={{
          width: 520,
          maxWidth: "100%",
          maxHeight: "82vh",
          borderRadius: 8,
      }}
    >
      {(close) => (
      <>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "12px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>{t("toolsConfig.title")}</div>
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" onClick={() => setAll(true)} disabled={loading || tools.length === 0} style={headerButtonStyle}>
              {t("toolsConfig.enableAll")}
            </button>
            <button type="button" onClick={() => setAll(false)} disabled={loading || tools.length === 0} style={headerButtonStyle}>
              {t("toolsConfig.disableAll")}
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "8px 0" }}>
          {loading ? (
            <div style={emptyStyle}>{t("toolsConfig.loading")}</div>
          ) : error ? (
            <div style={{ ...emptyStyle, color: "#ef4444" }}>{error}</div>
          ) : tools.length === 0 ? (
            <div style={emptyStyle}>{cwd ? t("toolsConfig.empty") : t("toolsConfig.noCwd")}</div>
          ) : (
            <>
              <ToolGroup title={t("toolsConfig.builtIn")} tools={builtinTools} active={active} onToggle={toggle} />
              <ToolGroup title={t("toolsConfig.extensions")} tools={extensionTools} active={active} onToggle={toggle} />
            </>
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{t("toolsConfig.applyHint")}</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={close} style={footerButtonStyle}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              onClick={() => {
                void handleSave().then((saved) => {
                  if (saved) close();
                });
              }}
              disabled={saving || loading || tools.length === 0}
              style={{
                ...footerButtonStyle,
                border: "none",
                background: "var(--accent)",
                color: "#fff",
                opacity: saving || loading || tools.length === 0 ? 0.6 : 1,
              }}
            >
              {saving ? t("toolsConfig.saving") : t("toolsConfig.save")}
            </button>
          </div>
        </div>
      </>
      )}
    </MotionModal>
  );
}

function ToolGroup({
  title,
  tools,
  active,
  onToggle,
}: {
  title: string;
  tools: ToolToggleEntry[];
  active: Set<string>;
  onToggle: (name: string) => void;
}) {
  if (tools.length === 0) return null;

  return (
    <>
      <div style={{ padding: "8px 18px 4px", fontSize: 11, color: "var(--text-dim)", fontWeight: 650 }}>{title}</div>
      {tools.map((tool) => (
        <ToolRow key={tool.name} tool={tool} active={active.has(tool.name)} onToggle={onToggle} />
      ))}
    </>
  );
}

function ToolRow({ tool, active, onToggle }: { tool: ToolToggleEntry; active: boolean; onToggle: (name: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(tool.name)}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        width: "100%",
        minHeight: 50,
        padding: "8px 18px",
        border: "none",
        background: "transparent",
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
    >
      <span
        style={{
          width: 34,
          height: 18,
          borderRadius: 999,
          background: active ? "var(--accent)" : "var(--border)",
          position: "relative",
          transition: "background 0.15s",
          flexShrink: 0,
          marginTop: 2,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: active ? 18 : 2,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: "#fff",
            transition: "left 0.15s",
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
          }}
        />
      </span>
      <span style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <span
          style={{
            fontSize: 13,
            lineHeight: 1.25,
            fontWeight: active ? 650 : 500,
            color: active ? "var(--text)" : "var(--text-muted)",
            fontFamily: "var(--font-mono)",
            overflowWrap: "anywhere",
          }}
        >
          {tool.name}
        </span>
        <span
          style={{
            fontSize: 11,
            lineHeight: 1.35,
            color: "var(--text-dim)",
            overflowWrap: "anywhere",
          }}
        >
          {tool.description}
        </span>
      </span>
    </button>
  );
}

const headerButtonStyle: CSSProperties = {
  height: 26,
  padding: "0 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 11,
};

const footerButtonStyle: CSSProperties = {
  height: 30,
  padding: "0 14px",
  borderRadius: 7,
  border: "1px solid var(--border)",
  background: "none",
  color: "var(--text-muted)",
  cursor: "pointer",
  fontSize: 12,
};

const emptyStyle: CSSProperties = {
  padding: "40px 18px",
  textAlign: "center",
  fontSize: 12,
  color: "var(--text-dim)",
};
