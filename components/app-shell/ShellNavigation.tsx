"use client";

import { memo, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { SessionSidebar } from "../SessionSidebar";
import { BranchNavigator } from "../BranchNavigator";
import { AgentsMdStatus } from "../AgentsMdStatus";
import { ThemeCycleButton } from "../ThemeCycleButton";
import { UiModeToggleButton } from "../UiModeToggleButton";
import { LocaleToggleButton } from "../LocaleToggleButton";
import { APP_NAME } from "@/lib/branding";
import { apiPath } from "@/lib/api-path";
import { useLocale } from "@/lib/i18n";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import { formatBytes } from "./helpers";
import type { DebugBundleSummary, FluidContextTab, FluidDrawerView } from "./types";

const MemoSessionSidebar = memo(SessionSidebar);

function FluidRailHint({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <span className="pi-fluid-rail-item">
      {children}
      <span className="pi-fluid-rail-tooltip" role="tooltip" aria-hidden="true">
        <span className="pi-fluid-rail-tooltip-label">{label}</span>
        <span className="pi-fluid-rail-tooltip-description">{description}</span>
      </span>
    </span>
  );
}

interface Props {
  isFluid: boolean;
  effectiveSidebarOpen: boolean;
  fluidDrawerOpen: boolean;
  fluidDrawerView: FluidDrawerView;
  fluidContextTab: FluidContextTab;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setFluidDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setFluidContextTab: Dispatch<SetStateAction<FluidContextTab>>;
  onOpenFluidDrawer: (view: FluidDrawerView) => void;
  onOpenModels: () => void;
  onOpenCapabilities: () => void;
  capabilitiesCwd: string | null;
  selectedSession: SessionInfo | null;
  newSessionCwd: string | null;
  initialSessionId: string | null;
  refreshKey: number;
  explorerRefreshKey: number;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession: (sessionId: string, cwd: string) => void;
  onInitialRestoreDone: () => void;
  onSessionDeleted: (sessionId: string) => void;
  onCwdChange: (cwd: string | null) => void;
  onOpenFile: (filePath: string, fileName: string) => void;
  onAtMention: (path: string) => void;
  onSessionImport: () => void;
  sessionImporting: boolean;
  sessionImportError: string | null;
  debugBundleSummary: DebugBundleSummary | null;
  onDebugBundleConfirm: () => void;
  onDebugBundleCancel: () => void;
  fluidWorkspaceCwd: string | null;
  branchTree: SessionTreeNode[];
  branchActiveLeafId: string | null;
  onBranchLeafChange: (leafId: string | null) => void;
  systemPrompt: string | null;
}

export const ShellNavigation = memo(function ShellNavigation({
  isFluid,
  effectiveSidebarOpen,
  fluidDrawerOpen,
  fluidDrawerView,
  fluidContextTab,
  setSidebarOpen,
  setFluidDrawerOpen,
  setFluidContextTab,
  onOpenFluidDrawer,
  onOpenModels,
  onOpenCapabilities,
  capabilitiesCwd,
  selectedSession,
  newSessionCwd,
  initialSessionId,
  refreshKey,
  explorerRefreshKey,
  onSelectSession,
  onNewSession,
  onInitialRestoreDone,
  onSessionDeleted,
  onCwdChange,
  onOpenFile,
  onAtMention,
  onSessionImport,
  sessionImporting,
  sessionImportError,
  debugBundleSummary,
  onDebugBundleConfirm,
  onDebugBundleCancel,
  fluidWorkspaceCwd,
  branchTree,
  branchActiveLeafId,
  onBranchLeafChange,
  systemPrompt,
}: Props) {
  const { t } = useLocale();
  const railItems = {
    sessions: [t("fluidRail.sessions.label"), t("fluidRail.sessions.description")],
    explorer: [t("fluidRail.explorer.label"), t("fluidRail.explorer.description")],
    context: [t("fluidRail.context.label"), t("fluidRail.context.description")],
    models: [t("fluidRail.models.label"), t("fluidRail.models.description")],
    capabilities: [
      t("fluidRail.capabilities.label"),
      capabilitiesCwd ? t("fluidRail.capabilities.description") : t("fluidRail.capabilities.disabledDescription"),
    ],
    theme: [t("fluidRail.theme.label"), t("fluidRail.theme.description")],
    ui: [t("fluidRail.uiMode.label"), t("fluidRail.uiMode.description")],
    locale: [t("fluidRail.locale.label"), t("fluidRail.locale.description")],
  } as const;

  const sidebarContent = !isFluid || !fluidDrawerOpen || fluidDrawerView !== "context" ? (
    <>
      <MemoSessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={onSelectSession}
        onNewSession={onNewSession}
        initialSessionId={initialSessionId}
        onInitialRestoreDone={onInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={onSessionDeleted}
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={onCwdChange}
        onOpenFile={onOpenFile}
        explorerRefreshKey={explorerRefreshKey}
        onAtMention={onAtMention}
      />
      {!isFluid && <div className="pi-sidebar-footer" style={{ padding: "8px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <ThemeCycleButton variant="footer" />
        <UiModeToggleButton variant="footer" />
        {([
          { id: "models", label: t("nav.models"), shortLabel: t("nav.models"), onClick: onOpenModels, disabled: false, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" /><line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" /><line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" /><line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" /></svg> },
          { id: "capabilities", label: t("nav.capabilities"), shortLabel: t("nav.capabilitiesShort"), onClick: onOpenCapabilities, disabled: !capabilitiesCwd, icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg> },
        ] as { id: string; label: string; shortLabel: string; onClick: () => void; disabled: boolean; icon: ReactNode }[]).map(({ id, label, shortLabel, onClick, disabled, icon }) => (
          <button key={id} onClick={onClick} disabled={disabled} title={label} style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 3, height: 32, minWidth: 0, padding: "0 3px", background: "none", border: "none", borderRadius: 8, color: "var(--text-muted)", cursor: disabled ? "default" : "pointer", fontSize: 10.5, opacity: disabled ? 0.35 : 1, transition: "background 0.12s, color 0.12s" }} onMouseEnter={(event) => { if (!disabled) { event.currentTarget.style.background = "var(--bg-hover)"; event.currentTarget.style.color = "var(--text)"; } }} onMouseLeave={(event) => { event.currentTarget.style.background = "none"; event.currentTarget.style.color = "var(--text-muted)"; }}>
            {icon}<span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortLabel}</span>
          </button>
        ))}
      </div>}
    </>
  ) : null;

  const contextContent = isFluid && fluidDrawerOpen && fluidDrawerView === "context" ? (
    <div className="pi-fluid-context-drawer">
      <div className="pi-fluid-drawer-heading">
        <div><div className="pi-fluid-drawer-kicker">Context</div><div className="pi-fluid-drawer-title">Session tools</div></div>
        <div className="pi-fluid-context-tabs">
          <button type="button" className={fluidContextTab === "session" ? "active" : ""} onClick={() => setFluidContextTab("session")}>{t("session.label")}</button>
          <button type="button" className={fluidContextTab === "system" ? "active" : ""} onClick={() => setFluidContextTab("system")}>{t("system.label")}</button>
        </div>
      </div>
      {fluidContextTab === "session" ? (
        <div className="pi-fluid-context-section">
          <div className="pi-fluid-context-actions">
            <button type="button" onClick={onSessionImport} disabled={sessionImporting}>{sessionImporting ? t("session.importing") : t("session.import")}</button>
            {selectedSession ? <>
              <a href={apiPath(`sessions/${encodeURIComponent(selectedSession.id)}/export?format=markdown${branchActiveLeafId ? `&leafId=${encodeURIComponent(branchActiveLeafId)}` : ""}`)} download>{t("session.exportMarkdown")}</a>
              <a href={apiPath(`sessions/${encodeURIComponent(selectedSession.id)}/export?format=json${branchActiveLeafId ? `&leafId=${encodeURIComponent(branchActiveLeafId)}` : ""}`)} download>{t("session.exportJson")}</a>
              <a href={apiPath(`sessions/${encodeURIComponent(selectedSession.id)}/debug-bundle`)} download>{t("session.exportDebugBundle")}</a>
            </> : <span className="pi-fluid-context-muted">{t("branches.noSession")}</span>}
          </div>
          {sessionImportError && <div className="pi-fluid-context-error">{t("session.importFailed")}: {sessionImportError}</div>}
          {debugBundleSummary && <div className="pi-fluid-debug-summary">
            <div className="pi-fluid-debug-title">{t("session.debugBundleReady")}</div>
            <div>{t("session.debugBundleTargetCwd")}: <span>{debugBundleSummary.targetCwd}</span></div>
            <div>{t("session.debugBundleContents", { files: debugBundleSummary.fileCount, fileBytes: formatBytes(debugBundleSummary.fileBytes), media: debugBundleSummary.mediaCount, mediaBytes: formatBytes(debugBundleSummary.mediaBytes) })}</div>
            <div className="pi-fluid-context-actions">
              <button type="button" onClick={() => void onDebugBundleConfirm()} disabled={sessionImporting}>{sessionImporting ? t("session.importing") : t("session.debugBundleImport")}</button>
              <button type="button" onClick={onDebugBundleCancel} disabled={sessionImporting}>{t("session.debugBundleCancel")}</button>
            </div>
          </div>}
          {fluidWorkspaceCwd && <AgentsMdStatus cwd={fluidWorkspaceCwd} variant="context" />}
          <div className="pi-fluid-branch-block">
            <div className="pi-fluid-section-label">{t("session.branches")}</div>
            <BranchNavigator sessionId={selectedSession?.id ?? null} tree={branchTree} activeLeafId={branchActiveLeafId} onLeafChange={onBranchLeafChange} hasSession={Boolean(selectedSession)} panelOnly />
          </div>
        </div>
      ) : <div className="pi-fluid-system-block">{systemPrompt ? <pre>{systemPrompt}</pre> : systemPrompt === "" ? <div className="pi-fluid-context-muted">{t("system.emptyTools")}</div> : <div className="pi-fluid-context-muted">{t("system.loadHint")}</div>}</div>}
    </div>
  ) : null;

  return <>
    <div className="sidebar-overlay-backdrop" onClick={() => isFluid ? setFluidDrawerOpen(false) : setSidebarOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 199, background: "rgba(0,0,0,0.4)", opacity: effectiveSidebarOpen ? 1 : 0, pointerEvents: effectiveSidebarOpen ? "auto" : "none", transition: "opacity 0.25s ease" }} />
    {isFluid && <div className="pi-fluid-rail" aria-label="Fluid command rail">
      <div className="pi-fluid-rail-brand" title={APP_NAME}>π</div>
      <FluidRailHint label={railItems.sessions[0]} description={railItems.sessions[1]}><button className={`pi-fluid-rail-button${fluidDrawerOpen && fluidDrawerView === "sessions" ? " pi-fluid-rail-button-active" : ""}`} type="button" title={`${railItems.sessions[0]}: ${railItems.sessions[1]}`} aria-label={`${railItems.sessions[0]}: ${railItems.sessions[1]}`} onClick={() => onOpenFluidDrawer("sessions")}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" /></svg></button></FluidRailHint>
      <FluidRailHint label={railItems.explorer[0]} description={railItems.explorer[1]}><button className={`pi-fluid-rail-button${fluidDrawerOpen && fluidDrawerView === "explorer" ? " pi-fluid-rail-button-active" : ""}`} type="button" onClick={() => onOpenFluidDrawer("explorer")} title={`${railItems.explorer[0]}: ${railItems.explorer[1]}`} aria-label={`${railItems.explorer[0]}: ${railItems.explorer[1]}`}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16" /><path d="M12 4v12" /><path d="m7 9 5-5 5 5" /></svg></button></FluidRailHint>
      <FluidRailHint label={railItems.context[0]} description={railItems.context[1]}><button className={`pi-fluid-rail-button${fluidDrawerOpen && fluidDrawerView === "context" ? " pi-fluid-rail-button-active" : ""}`} type="button" onClick={() => onOpenFluidDrawer("context")} title={`${railItems.context[0]}: ${railItems.context[1]}`} aria-label={`${railItems.context[0]}: ${railItems.context[1]}`}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h5" /></svg></button></FluidRailHint>
      <FluidRailHint label={railItems.models[0]} description={railItems.models[1]}><button className="pi-fluid-rail-button" type="button" onClick={onOpenModels} title={`${railItems.models[0]}: ${railItems.models[1]}`} aria-label={`${railItems.models[0]}: ${railItems.models[1]}`}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" /><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" /></svg></button></FluidRailHint>
      <FluidRailHint label={railItems.capabilities[0]} description={railItems.capabilities[1]}><button className="pi-fluid-rail-button" type="button" onClick={onOpenCapabilities} disabled={!capabilitiesCwd} title={`${railItems.capabilities[0]}: ${railItems.capabilities[1]}`} aria-label={`${railItems.capabilities[0]}: ${railItems.capabilities[1]}`}><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5" /><path d="m3 17 9 5 9-5" /></svg></button></FluidRailHint>
      <div className="pi-fluid-rail-spacer" />
      <FluidRailHint label={railItems.theme[0]} description={railItems.theme[1]}><ThemeCycleButton variant="rail" /></FluidRailHint>
      <FluidRailHint label={railItems.ui[0]} description={railItems.ui[1]}><UiModeToggleButton /></FluidRailHint>
      <FluidRailHint label={railItems.locale[0]} description={railItems.locale[1]}><LocaleToggleButton /></FluidRailHint>
    </div>}
    <div className={`sidebar-container pi-sidebar${isFluid ? " pi-fluid-drawer" : ""}${effectiveSidebarOpen ? " sidebar-open" : " sidebar-closed"}`} style={{ background: "var(--bg-panel)", borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", flexShrink: 0, zIndex: 200 }}>
      {isFluid && <div className="pi-fluid-drawer-bar"><div><div className="pi-fluid-drawer-kicker">{fluidDrawerView === "context" ? "Context" : fluidDrawerView === "explorer" ? "Workspace" : "Navigation"}</div><div className="pi-fluid-drawer-title">{fluidDrawerView === "context" ? "Session & System" : fluidDrawerView === "explorer" ? "Sessions & Explorer" : "Sessions"}</div></div><button type="button" onClick={() => setFluidDrawerOpen(false)} title={t("sidebar.hide")}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg></button></div>}
      {isFluid && fluidDrawerView === "context" ? contextContent : sidebarContent}
    </div>
  </>;
});
