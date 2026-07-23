"use client";

import { memo, type RefObject } from "react";
import { ChatWindow } from "../ChatWindow";
import { FluidEnvironmentPanel } from "../FluidEnvironmentPanel";
import type { ChatInputHandle, ComposerActivity } from "../ChatInput";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import { useLocale } from "@/lib/i18n";
import { ClassicWorkspaceHeader } from "./ClassicWorkspaceHeader";
import { FluidWorkspaceHeader } from "./FluidWorkspaceHeader";
import type { DebugBundleSummary, FluidMetric, ShellContextUsage, ShellSessionStats, TaskStatus } from "./types";

interface Props {
  isFluid: boolean;
  showFluidEnvironmentPanel: boolean;
  topBarRef: RefObject<HTMLDivElement | null>;
  topPanelDropdownRef: RefObject<HTMLDivElement | null>;
  systemButtonRef: RefObject<HTMLButtonElement | null>;
  sidebarOpen: boolean;
  setSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showChat: boolean;
  showPlaceholder: boolean;
  activeTopPanel: "session" | "system" | null;
  topPanelPos: { top: number; left: number; width: number } | null;
  onToggleTopPanel: (panel: "session" | "system") => void;
  onCloseTopPanel: () => void;
  selectedSession: SessionInfo | null;
  newSessionCwd: string | null;
  effectiveNewSessionCwd: string | null;
  sessionKey: number;
  modelsRefreshKey: number;
  chatInputRef: RefObject<ChatInputHandle | null>;
  onAgentEnd: () => void;
  onSessionCreated: (session: SessionInfo) => void;
  onSessionForked: (sessionId: string) => void;
  onBranchDataChange: (tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => void;
  onSystemPromptChange: (prompt: string | null) => void;
  onSessionStatsChange: (stats: ShellSessionStats | null) => void;
  onContextUsageChange: (usage: ShellContextUsage | null) => void;
  onTaskStatusChange: (status: TaskStatus) => void;
  onComposerActivityChange: (activity: ComposerActivity) => void;
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
  fluidWorkspaceCwd: string | null;
  fluidWorkspaceLabel: string;
  fluidSessionTitle: string;
  fluidDisplayTitle: string;
  taskStatus: TaskStatus;
  composerActivity: ComposerActivity;
  fluidMetrics: FluidMetric[];
  fluidStatsTooltip?: string;
  refreshKey: number;
  activeCwd: string | null;
  onOpenFilePanel: () => void;
}

export const ShellWorkspace = memo(function ShellWorkspace(props: Props) {
  const { t } = useLocale();
  return <div className={`pi-center-pane${props.isFluid ? " pi-fluid-workspace" : ""}${props.showFluidEnvironmentPanel ? " pi-fluid-info-visible" : ""}`} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
    {props.isFluid ? <FluidWorkspaceHeader topBarRef={props.topBarRef} workspaceCwd={props.fluidWorkspaceCwd} workspaceLabel={props.fluidWorkspaceLabel} sessionTitle={props.fluidSessionTitle} displayTitle={props.fluidDisplayTitle} selectedSession={props.selectedSession} taskStatus={props.taskStatus} composerActivity={props.composerActivity} metrics={props.fluidMetrics} statsTooltip={props.fluidStatsTooltip} /> : <ClassicWorkspaceHeader topBarRef={props.topBarRef} dropdownRef={props.topPanelDropdownRef} systemButtonRef={props.systemButtonRef} sidebarOpen={props.sidebarOpen} setSidebarOpen={props.setSidebarOpen} showChat={props.showChat} activeTopPanel={props.activeTopPanel} topPanelPos={props.topPanelPos} onToggleTopPanel={props.onToggleTopPanel} onCloseTopPanel={props.onCloseTopPanel} selectedSession={props.selectedSession} sessionStats={props.sessionStats} contextUsage={props.contextUsage} rightPanelOpen={props.rightPanelOpen} systemPrompt={props.systemPrompt} onSessionImport={props.onSessionImport} sessionImporting={props.sessionImporting} sessionImportError={props.sessionImportError} debugBundleSummary={props.debugBundleSummary} onDebugBundleConfirm={props.onDebugBundleConfirm} onDebugBundleCancel={props.onDebugBundleCancel} branchTree={props.branchTree} branchActiveLeafId={props.branchActiveLeafId} onBranchLeafChange={props.onBranchLeafChange} />}
    <div className={`pi-chat-region${props.isFluid ? " pi-fluid-workspace-body" : ""}`} style={{ flex: 1, overflow: "hidden", position: "relative" }}>
      {props.showChat ? <ChatWindow key={props.sessionKey} session={props.selectedSession} newSessionCwd={props.effectiveNewSessionCwd ?? props.newSessionCwd} onAgentEnd={props.onAgentEnd} onSessionCreated={props.onSessionCreated} onSessionForked={props.onSessionForked} modelsRefreshKey={props.modelsRefreshKey} chatInputRef={props.chatInputRef} onBranchDataChange={props.onBranchDataChange} onSystemPromptChange={props.onSystemPromptChange} onSessionStatsChange={props.onSessionStatsChange} onContextUsageChange={props.onContextUsageChange} onTaskStatusChange={props.onTaskStatusChange} onComposerActivityChange={props.onComposerActivityChange} /> : props.showPlaceholder ? props.activeCwd ? <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 15 }}>{t("placeholder.selectSession")}</div> : <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "flex-start", gap: 8, userSelect: "none", pointerEvents: "none" }}><svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, flexShrink: 0 }}><line x1="20" y1="12" x2="4" y2="12" /><polyline points="10 6 4 12 10 18" /></svg><div><div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>{t("placeholder.getStarted")}</div><div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}><span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>{t("placeholder.stepSelectProject")}<br /><span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>{t("placeholder.stepAddModels")}</div></div></div> : null}
      {props.showFluidEnvironmentPanel && <FluidEnvironmentPanel cwd={props.fluidWorkspaceCwd} workspaceLabel={props.fluidWorkspaceLabel} sessionTitle={props.fluidSessionTitle} displayTitle={props.fluidDisplayTitle} taskStatus={props.taskStatus} sessionStats={props.sessionStats} contextUsage={props.contextUsage} refreshKey={props.refreshKey} onOpenFilePanel={props.onOpenFilePanel} />}
    </div>
  </div>;
});
