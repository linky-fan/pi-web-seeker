"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { apiPath } from "@/lib/api-path";
import type { SessionInfo } from "@/lib/types";
import type { Tab } from "../TabBar";
import { FLUID_INSPECTOR_TIER_TWO_MIN_VIEWPORT } from "./helpers";
import { appendUniqueTab, closeInspectorTab } from "./inspector-state";
import type { FluidInspectorTier } from "./types";

interface NavigationSnapshot {
  sidebarOpen: boolean;
  fluidDrawerOpen: boolean;
}

interface Options {
  isFluid: boolean;
  selectedSession: SessionInfo | null;
  activeCwd: string | null;
  browserLabel: string;
  remoteLabel: string;
  sidebarOpen: boolean;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  fluidDrawerOpen: boolean;
  setFluidDrawerOpen: Dispatch<SetStateAction<boolean>>;
  closeTopPanel: () => void;
}

export function useInspectorController({
  isFluid,
  selectedSession,
  activeCwd,
  browserLabel,
  remoteLabel,
  sidebarOpen,
  setSidebarOpen,
  fluidDrawerOpen,
  setFluidDrawerOpen,
  closeTopPanel,
}: Options) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [fluidTier, setFluidTier] = useState<FluidInspectorTier>(1);
  const [canUseTierTwo, setCanUseTierTwo] = useState(() => (
    typeof window === "undefined" ? true : window.innerWidth >= FLUID_INSPECTOR_TIER_TWO_MIN_VIEWPORT
  ));
  const navigationSnapshotRef = useRef<NavigationSnapshot | null>(null);
  const fluidInitializedRef = useRef(false);
  const activeTab = useMemo(() => tabs.find((tab) => tab.id === activeTabId) ?? null, [activeTabId, tabs]);
  const interactivePanelMaximized = maximized && (activeTab?.kind === "browser" || activeTab?.kind === "remote");

  const openFile = useCallback((filePath: string, fileName: string) => {
    const tabId = `file:${filePath}`;
    setTabs((current) => appendUniqueTab(current, { id: tabId, label: fileName, kind: "file", filePath }));
    setActiveTabId(tabId);
    if (isFluid) setFluidTier(2);
    setPanelOpen(true);
  }, [isFluid]);

  const openBrowserForSession = useCallback((agentSessionId: string | undefined) => {
    if (!agentSessionId) return;
    const tabId = `browser:${agentSessionId}`;
    setTabs((current) => appendUniqueTab(current, {
      id: tabId,
      label: browserLabel,
      kind: "browser",
      agentSessionId,
      cwd: selectedSession?.cwd || activeCwd || "",
    }));
    setActiveTabId(tabId);
    setPanelOpen(true);
    if (isFluid) setFluidTier(2);
  }, [activeCwd, browserLabel, isFluid, selectedSession?.cwd]);

  const openBrowser = useCallback(() => {
    openBrowserForSession(selectedSession?.id);
  }, [openBrowserForSession, selectedSession?.id]);

  const openRemoteForSession = useCallback((agentSessionId: string | undefined) => {
    if (!agentSessionId) return;
    const tabId = `remote:${agentSessionId}`;
    setTabs((current) => appendUniqueTab(current, {
      id: tabId,
      label: remoteLabel,
      kind: "remote",
      agentSessionId,
      cwd: selectedSession?.cwd || activeCwd || "",
    }));
    setActiveTabId(tabId);
    setPanelOpen(true);
    if (isFluid) setFluidTier(2);
  }, [activeCwd, isFluid, remoteLabel, selectedSession?.cwd]);

  const openRemote = useCallback(() => {
    openRemoteForSession(selectedSession?.id);
  }, [openRemoteForSession, selectedSession?.id]);

  const closeTab = useCallback((tabId: string) => {
    const next = closeInspectorTab(tabs, activeTabId, tabId);
    setTabs(next.tabs);
    setActiveTabId(next.activeTabId);
    if (!next.panelOpen) setPanelOpen(false);
    if (tabId === activeTabId && (tabId.startsWith("browser:") || tabId.startsWith("remote:"))) setMaximized(false);
  }, [activeTabId, tabs]);

  const selectTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
    const tab = tabs.find((candidate) => candidate.id === tabId);
    if (isFluid && tab) setFluidTier(2);
  }, [isFluid, tabs]);

  const toggleMaximize = useCallback(() => {
    if (maximized) {
      setMaximized(false);
      return;
    }
    navigationSnapshotRef.current = { sidebarOpen, fluidDrawerOpen };
    setSidebarOpen(false);
    setFluidDrawerOpen(false);
    closeTopPanel();
    setMaximized(true);
  }, [closeTopPanel, fluidDrawerOpen, maximized, setFluidDrawerOpen, setSidebarOpen, sidebarOpen]);

  const togglePanel = useCallback(() => {
    if (!isFluid) {
      setPanelOpen((open) => !open);
      return;
    }
    const tierTwoAvailable = typeof window === "undefined"
      ? canUseTierTwo
      : window.innerWidth >= FLUID_INSPECTOR_TIER_TWO_MIN_VIEWPORT;
    if (!tierTwoAvailable) {
      setFluidTier(1);
      setPanelOpen((open) => !open);
      return;
    }
    if (!panelOpen) {
      setFluidTier(activeTab ? 2 : 1);
      setPanelOpen(true);
      return;
    }
    if (activeTab) {
      setFluidTier(1);
      setPanelOpen(false);
      return;
    }
    if (fluidTier === 1) {
      setFluidTier(2);
      return;
    }
    setFluidTier(1);
    setPanelOpen(false);
  }, [activeTab, canUseTierTwo, fluidTier, isFluid, panelOpen]);

  useEffect(() => {
    if (!selectedSession?.id) return;
    const source = new EventSource(apiPath(`/api/browser/sessions/${encodeURIComponent(selectedSession.id)}/events`));
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { type?: string };
        if (event.type && event.type !== "ready") openBrowserForSession(selectedSession.id);
      } catch {
        // Ignore malformed or transient events.
      }
    };
    return () => source.close();
  }, [openBrowserForSession, selectedSession?.id]);

  useEffect(() => {
    if (!selectedSession?.id) return;
    const source = new EventSource(apiPath(`/api/remote/sessions/${encodeURIComponent(selectedSession.id)}/events`));
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { type?: string };
        if (event.type && event.type !== "ready") openRemoteForSession(selectedSession.id);
      } catch {
        // Ignore malformed or transient events.
      }
    };
    return () => source.close();
  }, [openRemoteForSession, selectedSession?.id]);

  useEffect(() => {
    if (activeTab?.kind !== "browser" && activeTab?.kind !== "remote") setMaximized(false);
  }, [activeTab?.kind]);

  useEffect(() => {
    setMaximized(false);
  }, [isFluid, selectedSession?.id]);

  useEffect(() => {
    if (maximized) return;
    const snapshot = navigationSnapshotRef.current;
    if (!snapshot) return;
    navigationSnapshotRef.current = null;
    setSidebarOpen(snapshot.sidebarOpen);
    setFluidDrawerOpen(snapshot.fluidDrawerOpen);
  }, [maximized, setFluidDrawerOpen, setSidebarOpen]);

  useEffect(() => {
    if (!isFluid || !activeCwd || fluidInitializedRef.current) return;
    fluidInitializedRef.current = true;
    setFluidTier(1);
    setPanelOpen(true);
  }, [activeCwd, isFluid]);

  useEffect(() => {
    if (!isFluid || typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(`(min-width: ${FLUID_INSPECTOR_TIER_TWO_MIN_VIEWPORT}px)`);
    const apply = (available: boolean) => {
      setCanUseTierTwo((current) => current === available ? current : available);
      if (!available) setFluidTier(1);
    };
    const handleChange = (event: MediaQueryListEvent) => apply(event.matches);
    apply(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [isFluid]);

  const toggleTitle = isFluid
    ? !panelOpen
      ? "Show file panel"
      : activeTab ? "Hide file panel" : canUseTierTwo && fluidTier === 1 ? "Expand file panel" : "Hide file panel"
    : panelOpen ? "Hide file panel" : "Show file panel";

  return {
    tabs,
    activeTabId,
    activeTab,
    panelOpen,
    maximized,
    interactivePanelMaximized,
    fluidTier,
    canUseTierTwo,
    toggleTitle,
    selectTab,
    openFile,
    openBrowser,
    openRemote,
    closeTab,
    toggleMaximize,
    togglePanel,
  };
}
