"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiPath } from "@/lib/api-path";
import { getFileName, joinFilePath } from "@/lib/file-paths";
import { useLocale } from "@/lib/i18n";
import {
  MAX_CHECKER_SELECTION,
  type CheckerDiagnostic,
  type CheckerInventory,
  type CheckerResult,
  type CheckerTarget,
} from "@/lib/checkers/types";

interface Props {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string, lineNumber?: number) => void;
}

function statusKey(status: CheckerResult["status"]): string {
  return `checkers.status.${status}`;
}

function severityColor(severity: CheckerDiagnostic["severity"]): string {
  if (severity === "error") return "#f87171";
  if (severity === "warning") return "#fbbf24";
  return "var(--text-muted)";
}

function targetPath(cwd: string, projectPath: string, diagnosticPath: string): string {
  const projectRoot = projectPath === "." ? cwd : joinFilePath(cwd, projectPath);
  return joinFilePath(projectRoot, diagnosticPath);
}

export function CheckersPanel({ cwd, onOpenFile }: Props) {
  const { t } = useLocale();
  const [inventory, setInventory] = useState<CheckerInventory | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [results, setResults] = useState<CheckerResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const runControllerRef = useRef<AbortController | null>(null);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setInventory(null);
    setResults([]);
    setSelectedIds([]);
    setConfirmed(false);
    setError(null);

    fetch(apiPath(`checkers?cwd=${encodeURIComponent(cwd)}`), { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as CheckerInventory & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? t("checkers.loadFailed"));
        return payload;
      })
      .then((payload) => {
        setInventory(payload);
        setSelectedIds(payload.targets.filter((target) => target.available).slice(0, MAX_CHECKER_SELECTION).map((target) => target.id));
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : t("checkers.loadFailed"));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [cwd, refreshKey, t]);

  useEffect(() => () => runControllerRef.current?.abort(), []);

  const toggleTarget = useCallback((target: CheckerTarget) => {
    if (!target.available) return;
    setSelectedIds((current) => current.includes(target.id)
      ? current.filter((id) => id !== target.id)
      : current.length >= MAX_CHECKER_SELECTION ? current : [...current, target.id]);
  }, []);

  const runSelected = useCallback(async () => {
    if (!confirmed || selectedIds.length === 0 || running) return;
    const controller = new AbortController();
    runControllerRef.current = controller;
    setRunning(true);
    setError(null);
    setResults([]);
    try {
      const response = await fetch(apiPath("checkers"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ cwd, checkerIds: selectedIds, confirmed: true }),
      });
      const payload = await response.json() as { results?: CheckerResult[]; error?: string };
      if (!response.ok) throw new Error(payload.error ?? t("checkers.runFailed"));
      setResults(payload.results ?? []);
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError(reason instanceof Error ? reason.message : t("checkers.runFailed"));
      }
    } finally {
      if (runControllerRef.current === controller) runControllerRef.current = null;
      setRunning(false);
    }
  }, [confirmed, cwd, running, selectedIds, t]);

  const stopRun = useCallback(() => runControllerRef.current?.abort(), []);

  const openDiagnostic = useCallback((result: CheckerResult, diagnostic: CheckerDiagnostic) => {
    if (!diagnostic.path) return;
    const filePath = targetPath(cwd, result.projectPath, diagnostic.path);
    onOpenFile(filePath, getFileName(filePath), diagnostic.line);
  }, [cwd, onOpenFile]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--bg)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 650, color: "var(--text)" }}>{t("checkers.title")}</div>
          <div style={{ marginTop: 3, fontSize: 11, color: "var(--text-dim)" }}>{t("checkers.subtitle")}</div>
        </div>
        <button
          type="button"
          onClick={() => setRefreshKey((key) => key + 1)}
          disabled={loading || running}
          title={t("checkers.refresh")}
          style={{ height: 28, padding: "0 9px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text-muted)", cursor: loading || running ? "default" : "pointer", fontSize: 11 }}
        >
          {t("checkers.refresh")}
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 14 }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 14, padding: 10, borderRadius: 7, border: "1px solid rgba(251,191,36,0.25)", background: "rgba(251,191,36,0.06)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5 }}>
          <span aria-hidden="true" style={{ color: "#fbbf24", fontWeight: 700 }}>!</span>
          <span>{t("checkers.trustNotice")}</span>
        </div>

        {loading && <div role="status" style={{ color: "var(--text-muted)", fontSize: 12 }}>{t("checkers.scanning")}</div>}
        {error && <div role="alert" style={{ marginBottom: 12, color: "#f87171", fontSize: 12 }}>{error}</div>}

        {!loading && inventory?.targets.length === 0 && (
          <div style={{ padding: "22px 12px", textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
            {t("checkers.noProjects")}
          </div>
        )}

        {inventory?.truncated && (
          <div style={{ marginBottom: 12, color: "var(--text-dim)", fontSize: 11 }}>{t("checkers.scanLimited", { count: inventory.scannedDirectories })}</div>
        )}
        {inventory && inventory.targets.filter((target) => target.available).length > MAX_CHECKER_SELECTION && (
          <div style={{ marginBottom: 12, color: "var(--text-dim)", fontSize: 11 }}>{t("checkers.selectionLimited", { count: MAX_CHECKER_SELECTION })}</div>
        )}

        {inventory?.targets.map((target) => (
          <label
            key={target.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 9,
              marginBottom: 7,
              padding: "10px 11px",
              border: "1px solid var(--border)",
              borderRadius: 7,
              background: selectedSet.has(target.id) ? "var(--bg-hover)" : "var(--bg-panel)",
              opacity: target.available ? 1 : 0.7,
              cursor: target.available ? "pointer" : "default",
            }}
          >
            <input
              type="checkbox"
              checked={selectedSet.has(target.id)}
              disabled={!target.available || running || (!selectedSet.has(target.id) && selectedIds.length >= MAX_CHECKER_SELECTION)}
              onChange={() => toggleTarget(target)}
              style={{ margin: "2px 0 0", accentColor: "var(--accent)" }}
            />
            <span style={{ minWidth: 0, flex: 1 }}>
              <span style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text)", fontSize: 12, fontWeight: 600 }}>
                <span>{target.label}</span>
                <span style={{ color: "var(--text-dim)", fontSize: 10, fontWeight: 400 }}>{target.projectPath}</span>
              </span>
              {target.reason && <span style={{ display: "block", marginTop: 4, color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45 }}>{t(`checkers.reason.${target.reason}`)}</span>}
              {target.note && <span style={{ display: "block", marginTop: 4, color: "var(--text-dim)", fontSize: 10, lineHeight: 1.45 }}>{t(`checkers.note.${target.note}`)}</span>}
            </span>
            {!target.available && <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{t("checkers.unavailable")}</span>}
          </label>
        ))}

        {inventory && inventory.targets.some((target) => target.available) && (
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
            <label style={{ display: "flex", alignItems: "flex-start", gap: 7, flex: "1 1 250px", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5 }}>
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={running} style={{ marginTop: 2, accentColor: "var(--accent)" }} />
              <span>{t("checkers.confirmRun")}</span>
            </label>
            {running ? (
              <button type="button" onClick={stopRun} style={{ height: 31, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}>
                {t("checkers.stop")}
              </button>
            ) : (
              <button type="button" onClick={() => void runSelected()} disabled={!confirmed || selectedIds.length === 0} style={{ height: 31, padding: "0 13px", border: "none", borderRadius: 6, background: "var(--accent)", color: "white", cursor: confirmed && selectedIds.length ? "pointer" : "default", opacity: confirmed && selectedIds.length ? 1 : 0.5, fontSize: 11, fontWeight: 650 }}>
                {t("checkers.run", { count: selectedIds.length })}
              </button>
            )}
          </div>
        )}

        {running && <div role="status" aria-live="polite" style={{ marginTop: 12, color: "var(--text-muted)", fontSize: 11 }}>{t("checkers.running")}</div>}

        {results.map((result) => (
          <section key={result.targetId} style={{ marginTop: 16, border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 11px", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>
              <strong style={{ color: "var(--text)", fontSize: 11 }}>{result.label}</strong>
              <span style={{ color: result.status === "failed" ? "#f87171" : result.status === "issues" ? "#fbbf24" : "#4ade80", fontSize: 11 }}>{t(statusKey(result.status))}</span>
              <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 10 }}>{t("checkers.duration", { duration: (result.durationMs / 1000).toFixed(1) })}</span>
            </div>
            {result.error && <div style={{ padding: "8px 11px", color: "#f87171", fontSize: 11 }}>{t(`checkers.error.${result.error}`)}</div>}
            {result.outputTruncated && <div style={{ padding: "8px 11px", color: "#fbbf24", fontSize: 11 }}>{t("checkers.outputLimited")}</div>}
            {result.diagnostics.length === 0 && !result.error && (
              <div style={{ padding: "9px 11px", color: "var(--text-muted)", fontSize: 11 }}>{t("checkers.noDiagnostics")}</div>
            )}
            {result.diagnostics.map((diagnostic) => (
              <button
                key={diagnostic.id}
                type="button"
                onClick={() => openDiagnostic(result, diagnostic)}
                disabled={!diagnostic.path}
                title={diagnostic.path ?? undefined}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "8px 11px",
                  border: "none",
                  borderTop: "1px solid var(--border)",
                  background: "transparent",
                  textAlign: "left",
                  cursor: diagnostic.path ? "pointer" : "default",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 10 }}>
                  <span style={{ color: severityColor(diagnostic.severity), fontWeight: 700, textTransform: "uppercase" }}>{t(`checkers.severity.${diagnostic.severity}`)}</span>
                  {diagnostic.code && <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{diagnostic.code}</span>}
                  {diagnostic.path && <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{diagnostic.path}{diagnostic.line ? `:${diagnostic.line}` : ""}</span>}
                </span>
                <span style={{ display: "block", marginTop: 4, color: "var(--text)", fontSize: 11, lineHeight: 1.45, overflowWrap: "anywhere" }}>{diagnostic.message}</span>
              </button>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
