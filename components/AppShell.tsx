"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "@/lib/i18n";
import { useUiMode } from "@/hooks/useUiMode";
import { APP_NAME } from "@/lib/branding";
import { revealElement } from "@/lib/motion";
import type { ChatInputHandle } from "./ChatInput";
import { ShellDeferredFeatures } from "./app-shell/ShellDeferredFeatures";
import { ClassicInspectorToggle, ShellInspector } from "./app-shell/ShellInspector";
import { ShellNavigation } from "./app-shell/ShellNavigation";
import { ShellWorkspace } from "./app-shell/ShellWorkspace";
import {
  buildFluidMetrics,
  normalizeExplorerMentionPath,
  normalizeHeaderText,
  truncateFluidTitle,
  workspaceLabelFromCwd,
} from "./app-shell/helpers";
import type { FluidContextTab, FluidDrawerView } from "./app-shell/types";
import { useInspectorController } from "./app-shell/useInspectorController";
import { useSessionImportController } from "./app-shell/useSessionImportController";
import { useSessionWorkspaceController } from "./app-shell/useSessionWorkspaceController";

export function AppShell() {
  const { t } = useLocale();
  const { isFluid } = useUiMode();
  const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
  const [quickChatRequested, setQuickChatRequested] = useState(false);
  const [capabilitiesConfigOpen, setCapabilitiesConfigOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [fluidDrawerOpen, setFluidDrawerOpen] = useState(false);
  const [fluidDrawerView, setFluidDrawerView] = useState<FluidDrawerView>("sessions");
  const [fluidContextTab, setFluidContextTab] = useState<FluidContextTab>("session");
  const [activeTopPanel, setActiveTopPanel] = useState<"session" | "system" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const topPanelDropdownRef = useRef<HTMLDivElement>(null);
  const systemButtonRef = useRef<HTMLButtonElement>(null);

  const closeTopPanel = useCallback(() => setActiveTopPanel(null), []);
  const session = useSessionWorkspaceController({ onResetTransientUi: closeTopPanel });
  const sessionImport = useSessionImportController({ applyImportedSession: session.applyImportedSession });
  const inspector = useInspectorController({
    isFluid,
    selectedSession: session.selectedSession,
    activeCwd: session.activeCwd,
    browserLabel: t("browser.tab"),
    remoteLabel: t("remote.tab"),
    sidebarOpen,
    setSidebarOpen,
    fluidDrawerOpen,
    setFluidDrawerOpen,
    closeTopPanel,
  });
  const openInspectorFile = inspector.openFile;
  const inspectorMaximized = inspector.maximized;
  const refreshModels = session.refreshModels;

  const toggleTopPanel = useCallback((panel: "session" | "system") => {
    setActiveTopPanel((current) => current === panel ? null : panel);
  }, []);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const rect = topBarRef.current!.getBoundingClientRect();
      setTopPanelPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(topBarRef.current);
    return () => observer.disconnect();
  }, [activeTopPanel]);

  useEffect(() => {
    if (!activeTopPanel) return;
    const tween = revealElement(topPanelDropdownRef.current, { y: -5, duration: 0.18 });
    return () => { tween?.kill(); };
  }, [activeTopPanel]);

  useEffect(() => {
    closeTopPanel();
    setFluidDrawerOpen(false);
  }, [closeTopPanel, isFluid]);

  const handleAtMention = useCallback((relativePath: string) => {
    const mention = normalizeExplorerMentionPath(relativePath);
    chatInputRef.current?.insertText(t(
      mention.projectRelative ? "explorer.insertPathPrompt" : "explorer.insertAbsolutePathPrompt",
      { path: mention.path },
    ));
  }, [t]);

  const handleOpenFileFromSidebar = useCallback((filePath: string, fileName: string) => {
    openInspectorFile(filePath, fileName);
    if (isFluid) setFluidDrawerOpen(false);
  }, [isFluid, openInspectorFile]);

  const openFluidDrawer = useCallback((view: FluidDrawerView) => {
    if (inspectorMaximized) return;
    setFluidDrawerView(view);
    setFluidDrawerOpen((open) => !(open && fluidDrawerView === view));
    closeTopPanel();
  }, [closeTopPanel, fluidDrawerView, inspectorMaximized]);

  const openModels = useCallback(() => setModelsConfigOpen(true), []);
  const dismissModels = useCallback(() => setModelsConfigOpen(false), []);
  const closeModels = useCallback(() => {
    setModelsConfigOpen(false);
    refreshModels();
  }, [refreshModels]);
  const openCapabilities = useCallback(() => setCapabilitiesConfigOpen(true), []);
  const closeCapabilities = useCallback(() => setCapabilitiesConfigOpen(false), []);
  const requestQuickChat = useCallback(() => setQuickChatRequested(true), []);
  const dismissQuickChat = useCallback(() => setQuickChatRequested(false), []);

  const fluidSessionTitle = normalizeHeaderText(
    session.selectedSession?.name
      || session.selectedSession?.firstMessage
      || (session.effectiveNewSessionCwd ? "New session" : APP_NAME),
  ) || APP_NAME;
  const fluidDisplayTitle = truncateFluidTitle(fluidSessionTitle);
  const fluidWorkspaceCwd = session.selectedSession?.cwd ?? session.effectiveNewSessionCwd ?? null;
  const fluidWorkspaceLabel = workspaceLabelFromCwd(fluidWorkspaceCwd);
  const fluidStats = buildFluidMetrics(session.sessionStats, session.contextUsage, {
    input: t("stats.input"),
    output: t("stats.output"),
    cacheRead: t("stats.cacheRead"),
    cacheWrite: t("stats.cacheWrite"),
    cost: t("stats.cost"),
    context: t("stats.context"),
    unknown: t("stats.unknown"),
  });
  const effectiveSidebarOpen = isFluid ? fluidDrawerOpen : sidebarOpen;
  const showFluidEnvironmentPanel = isFluid && session.showChat && !inspector.panelOpen;

  return <>
    <input
      ref={sessionImport.inputRef}
      type="file"
      accept=".json,.jsonl,.tar.gz,.tgz,application/json,application/x-ndjson,application/gzip"
      onChange={sessionImport.handleFile}
      style={{ display: "none" }}
    />
    <div
      className={`pi-app-shell${isFluid ? " pi-fluid-shell" : " pi-classic-shell"}${inspector.interactivePanelMaximized ? " pi-browser-focus-mode" : ""}${inspector.activeTab?.kind === "remote" ? " pi-remote-active" : ""}`}
      style={{ display: "flex", height: "100dvh", overflow: "hidden", background: "var(--bg)" }}
    >
      <ShellNavigation
        isFluid={isFluid}
        effectiveSidebarOpen={effectiveSidebarOpen}
        fluidDrawerOpen={fluidDrawerOpen}
        fluidDrawerView={fluidDrawerView}
        fluidContextTab={fluidContextTab}
        setSidebarOpen={setSidebarOpen}
        setFluidDrawerOpen={setFluidDrawerOpen}
        setFluidContextTab={setFluidContextTab}
        onOpenFluidDrawer={openFluidDrawer}
        onOpenModels={openModels}
        onOpenCapabilities={openCapabilities}
        capabilitiesCwd={session.capabilitiesCwd}
        selectedSession={session.selectedSession}
        newSessionCwd={session.newSessionCwd}
        initialSessionId={session.initialSessionId}
        refreshKey={session.refreshKey}
        explorerRefreshKey={session.explorerRefreshKey}
        onSelectSession={session.handleSelectSession}
        onNewSession={session.handleNewSession}
        onInitialRestoreDone={session.handleInitialRestoreDone}
        onSessionDeleted={session.handleSessionDeleted}
        onCwdChange={session.handleCwdChange}
        onOpenFile={handleOpenFileFromSidebar}
        onAtMention={handleAtMention}
        onSessionImport={sessionImport.openPicker}
        sessionImporting={sessionImport.importing}
        sessionImportError={sessionImport.error}
        debugBundleSummary={sessionImport.debugBundleSummary}
        onDebugBundleConfirm={sessionImport.confirmDebugBundle}
        onDebugBundleCancel={sessionImport.cancelDebugBundle}
        fluidWorkspaceCwd={fluidWorkspaceCwd}
        branchTree={session.branchTree}
        branchActiveLeafId={session.branchActiveLeafId}
        onBranchLeafChange={session.handleBranchLeafChange}
        systemPrompt={session.systemPrompt}
      />
      <ShellWorkspace
        isFluid={isFluid}
        showFluidEnvironmentPanel={showFluidEnvironmentPanel}
        topBarRef={topBarRef}
        topPanelDropdownRef={topPanelDropdownRef}
        systemButtonRef={systemButtonRef}
        sidebarOpen={sidebarOpen}
        setSidebarOpen={setSidebarOpen}
        showChat={session.showChat}
        showPlaceholder={session.showPlaceholder}
        activeTopPanel={activeTopPanel}
        topPanelPos={topPanelPos}
        onToggleTopPanel={toggleTopPanel}
        onCloseTopPanel={closeTopPanel}
        selectedSession={session.selectedSession}
        newSessionCwd={session.newSessionCwd}
        effectiveNewSessionCwd={session.effectiveNewSessionCwd}
        sessionKey={session.sessionKey}
        modelsRefreshKey={session.modelsRefreshKey}
        chatInputRef={chatInputRef}
        onAgentEnd={session.handleAgentEnd}
        onSessionCreated={session.handleSessionCreated}
        onSessionForked={session.handleSessionForked}
        onBranchDataChange={session.handleBranchDataChange}
        onSystemPromptChange={session.handleSystemPromptChange}
        onSessionStatsChange={session.handleSessionStatsChange}
        onContextUsageChange={session.handleContextUsageChange}
        onTaskStatusChange={session.handleTaskStatusChange}
        onComposerActivityChange={session.handleComposerActivityChange}
        sessionStats={session.sessionStats}
        contextUsage={session.contextUsage}
        rightPanelOpen={inspector.panelOpen}
        systemPrompt={session.systemPrompt}
        onSessionImport={sessionImport.openPicker}
        sessionImporting={sessionImport.importing}
        sessionImportError={sessionImport.error}
        debugBundleSummary={sessionImport.debugBundleSummary}
        onDebugBundleConfirm={sessionImport.confirmDebugBundle}
        onDebugBundleCancel={sessionImport.cancelDebugBundle}
        branchTree={session.branchTree}
        branchActiveLeafId={session.branchActiveLeafId}
        onBranchLeafChange={session.handleBranchLeafChange}
        fluidWorkspaceCwd={fluidWorkspaceCwd}
        fluidWorkspaceLabel={fluidWorkspaceLabel}
        fluidSessionTitle={fluidSessionTitle}
        fluidDisplayTitle={fluidDisplayTitle}
        taskStatus={session.taskStatus}
        composerActivity={session.composerActivity}
        fluidMetrics={fluidStats.metrics}
        fluidStatsTooltip={fluidStats.tooltip}
        refreshKey={session.refreshKey}
        activeCwd={session.activeCwd}
        onOpenFilePanel={inspector.togglePanel}
      />
      <ShellInspector
        isFluid={isFluid}
        fluidTier={inspector.fluidTier}
        panelOpen={inspector.panelOpen}
        activeTab={inspector.activeTab}
        tabs={inspector.tabs}
        activeTabId={inspector.activeTabId}
        interactivePanelMaximized={inspector.interactivePanelMaximized}
        activeCwd={session.activeCwd}
        selectedSession={session.selectedSession}
        toggleTitle={inspector.toggleTitle}
        onSelectTab={inspector.selectTab}
        onCloseTab={inspector.closeTab}
        onOpenBrowser={inspector.openBrowser}
        onOpenRemote={inspector.openRemote}
        onToggleMaximize={inspector.toggleMaximize}
        onTogglePanel={inspector.togglePanel}
      />
    </div>
    <ClassicInspectorToggle visible={!isFluid && !inspector.interactivePanelMaximized} panelOpen={inspector.panelOpen} title={inspector.toggleTitle} onToggle={inspector.togglePanel} />
    <ShellDeferredFeatures
      modelsOpen={modelsConfigOpen}
      onCloseModels={closeModels}
      onDismissModels={dismissModels}
      quickChatRequested={quickChatRequested}
      onRequestQuickChat={requestQuickChat}
      onDismissQuickChat={dismissQuickChat}
      activeCwd={session.activeCwd}
      modelsRefreshKey={session.modelsRefreshKey}
      onOpenModels={openModels}
      onPromoted={session.applyImportedSession}
      capabilitiesOpen={capabilitiesConfigOpen}
      capabilitiesCwd={session.capabilitiesCwd}
      onCloseCapabilities={closeCapabilities}
    />
  </>;
}
