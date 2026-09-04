"use client";

import { memo } from "react";
import dynamic from "next/dynamic";
import { DeferredFeatureBoundary, DeferredFeatureError, DeferredFeatureLoading } from "../DeferredFeature";
import { FileViewer } from "../FileViewer";
import { TabBar, type Tab } from "../TabBar";
import { useLocale } from "@/lib/i18n";
import type { SessionInfo } from "@/lib/types";
import type { FluidInspectorTier } from "./types";

const BrowserPanel = dynamic(() => import("../BrowserPanel").then((module) => module.BrowserPanel), {
  ssr: false,
  loading: () => <DeferredFeatureLoading featureKey="browser.tab" variant="panel" />,
});

const RemotePanel = dynamic(() => import("../RemotePanel").then((module) => module.RemotePanel), {
  ssr: false,
  loading: () => <DeferredFeatureLoading featureKey="remote.tab" variant="panel" />,
});

interface InspectorProps {
  isFluid: boolean;
  fluidTier: FluidInspectorTier;
  panelOpen: boolean;
  activeTab: Tab | null;
  tabs: Tab[];
  activeTabId: string | null;
  interactivePanelMaximized: boolean;
  activeCwd: string | null;
  selectedSession: SessionInfo | null;
  toggleTitle: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onOpenBrowser: () => void;
  onOpenRemote: () => void;
  onToggleMaximize: () => void;
  onTogglePanel: () => void;
}

export const ShellInspector = memo(function ShellInspector(props: InspectorProps) {
  const { t } = useLocale();
  const interactive = props.activeTab?.kind === "browser" || props.activeTab?.kind === "remote";
  const widePanel = props.activeTab !== null;
  return <>
    <div
      className={`right-panel-container ${props.isFluid ? `pi-fluid-inspector pi-fluid-inspector-tier-${props.fluidTier}` : "pi-right-panel"}${props.panelOpen ? " right-panel-open" : " right-panel-closed"}${widePanel ? " pi-wide-panel-active" : ""}${interactive ? " pi-browser-panel-active" : ""}${props.activeTab?.kind === "remote" ? " pi-remote-panel-active" : ""}${props.interactivePanelMaximized ? " pi-browser-panel-maximized" : ""}`}
      style={{ display: "flex", flexDirection: "column", borderLeft: "1px solid var(--border)", background: "var(--bg)" }}
    >
      <div className="pi-right-panel-header" style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 36 }}>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <TabBar tabs={props.tabs} activeTabId={props.activeTabId ?? ""} onSelectTab={props.onSelectTab} onCloseTab={props.onCloseTab} />
        </div>
        <button className="pi-browser-open-tab" onClick={() => props.onOpenBrowser()} disabled={!props.selectedSession} title={props.selectedSession ? t("browser.openTab") : t("browser.requiresSession")} aria-label={props.selectedSession ? t("browser.openTab") : t("browser.requiresSession")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
        </button>
        <button className="pi-browser-open-tab" onClick={() => props.onOpenRemote()} disabled={!props.selectedSession} title={props.selectedSession ? t("remote.openTab") : t("remote.requiresSession")} aria-label={props.selectedSession ? t("remote.openTab") : t("remote.requiresSession")}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></svg>
        </button>
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        {props.activeTab?.kind === "file" ? <FileViewer filePath={props.activeTab.filePath} cwd={props.activeCwd ?? undefined} /> : props.activeTab?.kind === "browser" ? (
          <DeferredFeatureBoundary resetKey={props.activeTab.id} fallback={<DeferredFeatureError featureKey="browser.tab" variant="panel" onDismiss={() => props.onCloseTab(props.activeTab!.id)} />}>
            <BrowserPanel agentSessionId={props.activeTab.agentSessionId} cwd={props.activeTab.cwd} maximized={props.interactivePanelMaximized} onToggleMaximize={props.onToggleMaximize} onCloseTab={() => props.onCloseTab(props.activeTab!.id)} />
          </DeferredFeatureBoundary>
        ) : props.activeTab?.kind === "remote" ? (
          <DeferredFeatureBoundary resetKey={props.activeTab.id} fallback={<DeferredFeatureError featureKey="remote.tab" variant="panel" onDismiss={() => props.onCloseTab(props.activeTab!.id)} />}>
            <RemotePanel agentSessionId={props.activeTab.agentSessionId} cwd={props.activeTab.cwd} maximized={props.interactivePanelMaximized} onToggleMaximize={props.onToggleMaximize} onCloseTab={() => props.onCloseTab(props.activeTab!.id)} />
          </DeferredFeatureBoundary>
        ) : props.isFluid ? <div className="pi-fluid-inspector-empty"><div className="pi-fluid-inspector-empty-icon"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8" /><path d="M8 17h5" /></svg></div><div className="pi-fluid-inspector-empty-title">未打开文件</div><div className="pi-fluid-inspector-empty-text">从左侧 Explorer 打开文件</div></div> : <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>{t("file.noOpen")}</div>}
      </div>
    </div>
    {props.isFluid && !props.interactivePanelMaximized && <button className="pi-fluid-dock-handle" onClick={props.onTogglePanel} title={props.toggleTitle} aria-label={props.toggleTitle} aria-pressed={props.panelOpen}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" /></svg></button>}
  </>;
});

interface ClassicToggleProps {
  visible: boolean;
  panelOpen: boolean;
  title: string;
  onToggle: () => void;
}

export const ClassicInspectorToggle = memo(function ClassicInspectorToggle({ visible, panelOpen, title, onToggle }: ClassicToggleProps) {
  if (!visible) return null;
  return <button className="pi-right-panel-toggle" onClick={onToggle} title={title} aria-label={title} aria-pressed={panelOpen} style={{ position: "fixed", top: 0, right: 0, zIndex: 300, display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, padding: 0, background: "var(--bg-panel)", border: "none", borderLeft: "1px solid var(--border)", borderBottom: "1px solid var(--border)", color: panelOpen ? "var(--text)" : "var(--text-muted)", cursor: "pointer", transition: "color 0.12s" }} onMouseEnter={(event) => { event.currentTarget.style.color = "var(--text)"; }} onMouseLeave={(event) => { event.currentTarget.style.color = panelOpen ? "var(--text)" : "var(--text-muted)"; }}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" /></svg>
  </button>;
});
