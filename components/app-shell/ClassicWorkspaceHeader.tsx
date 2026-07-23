"use client";

import { memo, type Dispatch, type RefObject, type SetStateAction } from "react";
import { ThemeCycleButton } from "../ThemeCycleButton";
import { UiModeToggleButton } from "../UiModeToggleButton";
import { LocaleToggleButton } from "../LocaleToggleButton";
import { TopBarTypewriter } from "../BrandTypewriter";
import { BranchNavigator } from "../BranchNavigator";
import { apiPath } from "@/lib/api-path";
import { useLocale } from "@/lib/i18n";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import { formatBytes, formatCompactNumber } from "./helpers";
import type { DebugBundleSummary, ShellContextUsage, ShellSessionStats } from "./types";

const exportLinkStyle = {
  display: "inline-flex", alignItems: "center", height: 28, padding: "0 10px", borderRadius: 6,
  border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontSize: 12,
  fontWeight: 600, textDecoration: "none",
} as const;
const importButtonStyle = { ...exportLinkStyle, cursor: "pointer" } as const;

interface Props {
  topBarRef: RefObject<HTMLDivElement | null>;
  dropdownRef: RefObject<HTMLDivElement | null>;
  systemButtonRef: RefObject<HTMLButtonElement | null>;
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  showChat: boolean;
  activeTopPanel: "session" | "system" | null;
  topPanelPos: { top: number; left: number; width: number } | null;
  onToggleTopPanel: (panel: "session" | "system") => void;
  onCloseTopPanel: () => void;
  selectedSession: SessionInfo | null;
  sessionStats: ShellSessionStats | null;
  contextUsage: ShellContextUsage | null;
  rightPanelOpen: boolean;
  systemPrompt: string | null;
  onSessionImport: () => void;
  sessionImporting: boolean;
  sessionImportError: string | null;
  debugBundleSummary: DebugBundleSummary | null;
  onDebugBundleConfirm: () => void;
  onDebugBundleCancel: () => void;
  branchTree: SessionTreeNode[];
  branchActiveLeafId: string | null;
  onBranchLeafChange: (leafId: string | null) => void;
}

export const ClassicWorkspaceHeader = memo(function ClassicWorkspaceHeader({
  topBarRef, dropdownRef, systemButtonRef, sidebarOpen, setSidebarOpen, showChat, activeTopPanel,
  topPanelPos, onToggleTopPanel, onCloseTopPanel, selectedSession, sessionStats, contextUsage,
  rightPanelOpen, systemPrompt, onSessionImport, sessionImporting, sessionImportError,
  debugBundleSummary, onDebugBundleConfirm, onDebugBundleCancel, branchTree, branchActiveLeafId,
  onBranchLeafChange,
}: Props) {
  const { t } = useLocale();
  const tokens = sessionStats?.tokens;
  const cost = sessionStats?.cost ?? 0;
  const costText = cost > 0 ? cost >= 0.01 ? `$${cost.toFixed(2)}` : "<$0.01" : null;
  let contextColor = "var(--text-muted)";
  let contextText: string | null = null;
  if (contextUsage?.contextWindow) {
    if (contextUsage.percent !== null && contextUsage.percent > 90) contextColor = "#ef4444";
    else if (contextUsage.percent !== null && contextUsage.percent > 70) contextColor = "rgba(234,179,8,0.95)";
    contextText = contextUsage.percent !== null
      ? `${contextUsage.percent.toFixed(0)}% / ${formatCompactNumber(contextUsage.contextWindow)}`
      : `? / ${formatCompactNumber(contextUsage.contextWindow)}`;
  }
  const tooltipParts: string[] = [];
  if (tokens) {
    tooltipParts.push(`${t("stats.input")}: ${tokens.input.toLocaleString()}`);
    tooltipParts.push(`${t("stats.output")}: ${tokens.output.toLocaleString()}`);
    tooltipParts.push(`${t("stats.cacheRead")}: ${tokens.cacheRead.toLocaleString()}`);
    tooltipParts.push(`${t("stats.cacheWrite")}: ${tokens.cacheWrite.toLocaleString()}`);
    if (cost > 0) tooltipParts.push(`${t("stats.cost")}: $${cost.toFixed(4)}`);
  }
  if (contextUsage?.contextWindow) {
    tooltipParts.push(`${t("stats.context")}: ${contextUsage.percent !== null ? `${contextUsage.percent.toFixed(1)}%` : t("stats.unknown")} of ${contextUsage.contextWindow.toLocaleString()} tokens`);
  }

  return <div ref={topBarRef} className="pi-topbar" style={{ display: "flex", alignItems: "center", flexShrink: 0, borderBottom: "1px solid var(--border)", height: 36, background: "var(--bg-panel)" }}>
    <button onClick={() => setSidebarOpen((open) => !open)} title={sidebarOpen ? t("sidebar.hide") : t("sidebar.show")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, padding: 0, background: "none", border: "none", borderRight: "1px solid var(--border)", color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s" }} onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text)"; }} onMouseLeave={(event) => { event.currentTarget.style.color = "var(--text-muted)"; }}>
      {sidebarOpen ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" /></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" /></svg>}
    </button>
    <ThemeCycleButton /><UiModeToggleButton /><LocaleToggleButton />
    {showChat && <div style={{ display: "flex", alignItems: "stretch", height: "100%" }}>
      <button className="pi-topbar-command" onClick={() => onToggleTopPanel("session")} style={{ display: "flex", alignItems: "center", gap: 6, height: "100%", padding: "0 12px", background: activeTopPanel === "session" ? "var(--bg-selected)" : "none", border: "none", borderTop: activeTopPanel === "session" ? "2px solid var(--accent)" : "2px solid transparent", borderRight: "1px solid var(--border)", cursor: "pointer", color: activeTopPanel === "session" ? "var(--text)" : "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap", transition: "color 0.1s, background 0.1s" }} onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text)"; }} onMouseLeave={(event) => { event.currentTarget.style.color = activeTopPanel === "session" ? "var(--text)" : "var(--text-muted)"; }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: selectedSession ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><path d="M8 13h8" /><path d="M8 17h5" /></svg><span>{t("session.label")}</span>
      </button>
      <button className="pi-topbar-command" ref={systemButtonRef} onClick={() => onToggleTopPanel("system")} style={{ display: "flex", alignItems: "center", gap: 6, height: "100%", padding: "0 12px", background: activeTopPanel === "system" ? "var(--bg-selected)" : "none", border: "none", borderTop: activeTopPanel === "system" ? "2px solid var(--accent)" : "2px solid transparent", borderRight: "1px solid var(--border)", cursor: "pointer", color: activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)", fontSize: 11, whiteSpace: "nowrap", transition: "color 0.1s, background 0.1s" }} onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text)"; }} onMouseLeave={(event) => { event.currentTarget.style.color = activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)"; }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: systemPrompt ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" /></svg><span>{t("system.label")}</span>
      </button>
    </div>}
    {showChat && <TopBarTypewriter />}
    {showChat && (sessionStats || contextUsage) && <div title={tooltipParts.join("  |  ")} style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10, paddingLeft: 12, paddingRight: rightPanelOpen ? 12 : 48, height: "100%", fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", cursor: "default", fontVariantNumeric: "tabular-nums" }}>
      {tokens && tokens.input > 0 && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="8.5" x2="5" y2="1.5" /><polyline points="2 4 5 1.5 8 4" /></svg>{formatCompactNumber(tokens.input)}</span>}
      {tokens && tokens.output > 0 && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" /></svg>{formatCompactNumber(tokens.output)}</span>}
      {tokens && tokens.cacheRead > 0 && <span style={{ display: "flex", alignItems: "center", gap: 4 }}><svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 5a3.5 3.5 0 1 1-1-2.45" /><polyline points="6.5 1.5 8.5 2.5 7.5 4.5" /></svg>{formatCompactNumber(tokens.cacheRead)}</span>}
      {costText && <span style={{ display: "flex", alignItems: "center", color: "var(--text)", fontWeight: 500 }}>{costText}</span>}
      {contextText && <span style={{ display: "flex", alignItems: "center", gap: 4, color: contextColor }}><svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 9 L1 5 Q1 1 5 1 Q9 1 9 5 L9 9" /><line x1="1" y1="9" x2="9" y2="9" /></svg>{contextText}</span>}
    </div>}
    {activeTopPanel && topPanelPos && <div ref={dropdownRef} className="pi-top-dropdown" style={{ position: "fixed", top: topPanelPos.top, left: topPanelPos.left, width: topPanelPos.width, zIndex: 500 }}>
      {activeTopPanel === "session" && <div style={{ background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", boxShadow: "0 10px 28px rgba(0,0,0,0.12)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 16px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text)", fontSize: 12, fontWeight: 650 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)" }}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>{t("session.exportTitle")}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" onClick={onSessionImport} disabled={sessionImporting} style={{ ...importButtonStyle, opacity: sessionImporting ? 0.6 : 1 }}>{sessionImporting ? t("session.importing") : t("session.import")}</button>
            {selectedSession ? <><a href={apiPath(`sessions/${encodeURIComponent(selectedSession.id)}/export?format=markdown${branchActiveLeafId ? `&leafId=${encodeURIComponent(branchActiveLeafId)}` : ""}`)} download onClick={onCloseTopPanel} style={exportLinkStyle}>{t("session.exportMarkdown")}</a><a href={apiPath(`sessions/${encodeURIComponent(selectedSession.id)}/export?format=json${branchActiveLeafId ? `&leafId=${encodeURIComponent(branchActiveLeafId)}` : ""}`)} download onClick={onCloseTopPanel} style={exportLinkStyle}>{t("session.exportJson")}</a><a href={apiPath(`sessions/${encodeURIComponent(selectedSession.id)}/debug-bundle`)} download onClick={onCloseTopPanel} style={exportLinkStyle}>{t("session.exportDebugBundle")}</a></> : <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("branches.noSession")}</span>}
          </div>
        </div>
        {sessionImportError && <div style={{ padding: "7px 16px", borderBottom: "1px solid var(--border)", color: "var(--danger)", fontSize: 12 }}>{t("session.importFailed")}: {sessionImportError}</div>}
        {debugBundleSummary && <div style={{ padding: "9px 16px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12, display: "grid", gap: 7 }}>
          <div style={{ color: "var(--text)", fontWeight: 650 }}>{t("session.debugBundleReady")}</div>
          <div style={{ display: "grid", gap: 4 }}><div>{t("session.debugBundleOriginalCwd")}: <span style={{ fontFamily: "var(--font-mono)" }}>{debugBundleSummary.manifest?.source?.cwd ?? "-"}</span></div><div>{t("session.debugBundleTargetCwd")}: <span style={{ fontFamily: "var(--font-mono)" }}>{debugBundleSummary.targetCwd}</span></div><div>{t("session.debugBundleContents", { files: debugBundleSummary.fileCount, fileBytes: formatBytes(debugBundleSummary.fileBytes), media: debugBundleSummary.mediaCount, mediaBytes: formatBytes(debugBundleSummary.mediaBytes) })}</div>{debugBundleSummary.manifest?.workspace?.excluded?.length ? <div>{t("session.debugBundleExcluded", { count: debugBundleSummary.manifest.workspace.excluded.length })}</div> : null}{debugBundleSummary.warnings?.slice(0, 3).map((warning, index) => <div key={`debug-warning:${index}`} style={{ color: "rgba(234,179,8,0.98)" }}>{warning}</div>)}</div>
          <div style={{ display: "flex", gap: 6 }}><button type="button" onClick={() => void onDebugBundleConfirm()} disabled={sessionImporting} style={{ ...importButtonStyle, opacity: sessionImporting ? 0.6 : 1 }}>{sessionImporting ? t("session.importing") : t("session.debugBundleImport")}</button><button type="button" onClick={onDebugBundleCancel} disabled={sessionImporting} style={{ ...importButtonStyle, opacity: sessionImporting ? 0.6 : 1 }}>{t("session.debugBundleCancel")}</button></div>
        </div>}
        <div style={{ paddingTop: 1 }}><div style={{ padding: "8px 16px 4px", fontSize: 10, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0 }}>{t("session.branches")}</div><BranchNavigator sessionId={selectedSession?.id ?? null} tree={branchTree} activeLeafId={branchActiveLeafId} onLeafChange={onBranchLeafChange} hasSession={Boolean(selectedSession)} panelOnly /></div>
      </div>}
      {activeTopPanel === "system" && <div style={{ background: "var(--bg-panel)", borderBottom: "1px solid var(--border)" }}>{systemPrompt ? <div style={{ maxHeight: "min(600px, 75vh)", overflowY: "auto", padding: "12px 16px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", fontFamily: "var(--font-mono)" }}>{systemPrompt}</div> : systemPrompt === "" ? <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>{t("system.emptyTools")}</div> : <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>{t("system.loadHint")}</div>}</div>}
    </div>}
  </div>;
});
