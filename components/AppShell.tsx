"use client";

import { memo, useState, useCallback, useRef, useEffect, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow } from "./ChatWindow";
import { FileViewer } from "./FileViewer";
import { TabBar, type Tab } from "./TabBar";
import { ModelsConfig } from "./ModelsConfig";
import { CapabilitiesConfig } from "./CapabilitiesConfig";
import { BranchNavigator } from "./BranchNavigator";
import { AgentsMdStatus } from "./AgentsMdStatus";
import { ThemeCycleButton } from "./ThemeCycleButton";
import { UiModeToggleButton } from "./UiModeToggleButton";
import { LocaleToggleButton } from "./LocaleToggleButton";
import { FluidEnvironmentPanel } from "./FluidEnvironmentPanel";
import { QuickChatPanel } from "./QuickChatPanel";
import { BrowserPanel } from "./BrowserPanel";
import { RemotePanel } from "./RemotePanel";
import { FluidSessionTypewriter, TopBarTypewriter } from "./BrandTypewriter";
import { useLocale } from "@/lib/i18n";
import { useUiMode } from "@/hooks/useUiMode";
import { APP_NAME } from "@/lib/branding";
import { revealElement } from "@/lib/motion";
import { apiPath } from "@/lib/api-path";
import type { SessionInfo, SessionTreeNode } from "@/lib/types";
import type { ChatInputHandle, ComposerActivity } from "./ChatInput";

type TaskStatus = "done" | "running" | "error";
type FluidDrawerView = "sessions" | "explorer" | "context";
type FluidContextTab = "session" | "system";
type FluidInspectorTier = 1 | 2;
type FluidMetricTone = "accent" | "warning" | "danger";

interface BrowserMaxNavigationSnapshot {
  sidebarOpen: boolean;
  fluidDrawerOpen: boolean;
}

interface FluidMetric {
  key: string;
  label: string;
  value: string;
  tone?: FluidMetricTone;
  title?: string;
}

const FLUID_TITLE_MAX_CHARS = 42;
const FLUID_RAIL_WIDTH = 44;
const FLUID_INSPECTOR_TIER_TWO_WIDTH = 560;
const FLUID_INSPECTOR_TIER_TWO_MIN_WORKSPACE = 680;
const FLUID_INSPECTOR_TIER_TWO_MIN_VIEWPORT =
  FLUID_RAIL_WIDTH + FLUID_INSPECTOR_TIER_TWO_WIDTH + FLUID_INSPECTOR_TIER_TWO_MIN_WORKSPACE;
const MemoSessionSidebar = memo(SessionSidebar);

interface DebugBundleSummary {
  targetCwd: string;
  sessionId: string;
  fileCount: number;
  fileBytes: number;
  mediaCount: number;
  mediaBytes: number;
  warnings?: string[];
  manifest?: {
    source?: {
      cwd?: string;
      platform?: string;
      appVersion?: string;
      piVersion?: string;
    };
    workspace?: {
      excluded?: Array<{ path: string; reason: string; size?: number }>;
    };
  };
}

const TASK_STATUS_META: Record<TaskStatus, { label: string; color: string; glow: string; shadow: string }> = {
  done: { label: "Done", color: "#34d399", glow: "#10b981", shadow: "rgba(16,185,129,0.72)" },
  running: { label: "Running", color: "#7dd3fc", glow: "#38bdf8", shadow: "rgba(56,189,248,0.76)" },
  error: { label: "Error", color: "#fb7185", glow: "#f43f5e", shadow: "rgba(244,63,94,0.76)" },
};

function statusFavicon(status: TaskStatus): string {
  const meta = TASK_STATUS_META[status];
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`,
    `<defs>`,
    `<radialGradient id="halo" cx="50%" cy="45%" r="60%">`,
    `<stop offset="0%" stop-color="${meta.glow}" stop-opacity="0.58"/>`,
    `<stop offset="58%" stop-color="${meta.glow}" stop-opacity="0.16"/>`,
    `<stop offset="100%" stop-color="${meta.glow}" stop-opacity="0"/>`,
    `</radialGradient>`,
    `<filter id="softGlow" x="-45%" y="-45%" width="190%" height="190%">`,
    `<feDropShadow dx="0" dy="0" stdDeviation="1.7" flood-color="${meta.shadow}"/>`,
    `</filter>`,
    `</defs>`,
    `<rect x="1" y="1" width="30" height="30" rx="8" fill="#08111f"/>`,
    `<rect x="1.75" y="1.75" width="28.5" height="28.5" rx="7.25" fill="none" stroke="${meta.glow}" stroke-opacity="0.34" stroke-width="1.1"/>`,
    `<circle cx="16" cy="16" r="15" fill="url(#halo)"/>`,
    `<text x="16" y="22.3" text-anchor="middle" font-size="22" font-family="Georgia, 'Times New Roman', serif" font-weight="700" fill="${meta.color}" filter="url(#softGlow)">π</text>`,
    status === "running"
      ? `<circle cx="25" cy="7.4" r="3.2" fill="${meta.glow}" filter="url(#softGlow)"/><circle cx="25" cy="7.4" r="1.3" fill="#ecfeff"/>`
      : "",
    status === "error"
      ? `<circle cx="25" cy="7.4" r="3.2" fill="${meta.glow}" filter="url(#softGlow)"/><path d="M25 5.6v2.2" stroke="#fff1f2" stroke-width="1.2" stroke-linecap="round"/><circle cx="25" cy="9.3" r="0.55" fill="#fff1f2"/>`
      : "",
    `</svg>`,
  ].join("");
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function updateBrowserTaskStatus(status: TaskStatus): void {
  if (typeof document === "undefined") return;
  const meta = TASK_STATUS_META[status];
  document.title = `${APP_NAME} - ${meta.label}`;
  let link = document.querySelector<HTMLLinkElement>('link[data-pi-task-status-icon="true"]');
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    link.type = "image/svg+xml";
    link.dataset.piTaskStatusIcon = "true";
    document.head.appendChild(link);
  }
  link.href = statusFavicon(status);
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value >= 10 || idx === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[idx]}`;
}

function normalizeHeaderText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncateFluidTitle(value: string): string {
  const normalized = normalizeHeaderText(value);
  if (normalized.length <= FLUID_TITLE_MAX_CHARS) return normalized;
  return `${normalized.slice(0, FLUID_TITLE_MAX_CHARS - 3).trimEnd()}...`;
}

function workspaceLabelFromCwd(cwd: string | null | undefined): string {
  if (!cwd) return APP_NAME;
  const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
  const label = normalized.split("/").filter(Boolean).pop();
  return label || normalized || APP_NAME;
}

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

function isDebugBundleFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".tar.gz") || name.endsWith(".tgz");
}

const sessionExportLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  height: 28,
  padding: "0 10px",
  borderRadius: 6,
  border: "1px solid var(--border)",
  background: "var(--bg)",
  color: "var(--text)",
  fontSize: 12,
  fontWeight: 600,
  textDecoration: "none",
} as const;

const sessionImportButtonStyle = {
  ...sessionExportLinkStyle,
  cursor: "pointer",
} as const;

function normalizeExplorerMentionPath(filePath: string): { path: string; projectRelative: boolean } {
  const normalized = filePath.replace(/\\/g, "/");
  const alreadyQualified = normalized.startsWith("/") ||
    normalized.startsWith("./") ||
    normalized.startsWith("../") ||
    /^[a-zA-Z]:\//.test(normalized) ||
    normalized.startsWith("//");

  return {
    path: alreadyQualified ? normalized : `./${normalized}`,
    projectRelative: !normalized.startsWith("/") && !/^[a-zA-Z]:\//.test(normalized) && !normalized.startsWith("//"),
  };
}

export function AppShell() {
  const { t } = useLocale();
  const { isFluid } = useUiMode();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [capabilitiesConfigOpen, setCapabilitiesConfigOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [fluidDrawerOpen, setFluidDrawerOpen] = useState(false);
  const [fluidDrawerView, setFluidDrawerView] = useState<FluidDrawerView>("sessions");
  const [fluidContextTab, setFluidContextTab] = useState<FluidContextTab>("session");
  const [taskStatus, setTaskStatus] = useState<TaskStatus>("done");
  const [composerActivity, setComposerActivity] = useState<ComposerActivity>({ focused: false, hasDraft: false });
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const topPanelDropdownRef = useRef<HTMLDivElement>(null);

  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeFnRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const systemBtnRef = useRef<HTMLButtonElement>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<{ tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost?: number } | null>(null);
  const handleSessionStatsChange = useCallback((stats: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost?: number } | null) => {
    setSessionStats(stats);
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const handleContextUsageChange = useCallback((usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => {
    setContextUsage(usage);
  }, []);

  const handleTaskStatusChange = useCallback((status: TaskStatus) => {
    setTaskStatus(status);
  }, []);

  const handleComposerActivityChange = useCallback((activity: ComposerActivity) => {
    setComposerActivity(activity);
  }, []);

  useEffect(() => {
    updateBrowserTaskStatus(taskStatus);
  }, [taskStatus]);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"session" | "system" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const sessionImportInputRef = useRef<HTMLInputElement>(null);
  const [sessionImporting, setSessionImporting] = useState(false);
  const [sessionImportError, setSessionImportError] = useState<string | null>(null);
  const [debugBundleFile, setDebugBundleFile] = useState<File | null>(null);
  const [debugBundleSummary, setDebugBundleSummary] = useState<DebugBundleSummary | null>(null);

  const toggleTopPanel = useCallback((panel: "session" | "system") => {
    setActiveTopPanel((cur) => cur === panel ? null : panel);
  }, []);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const rect = topBarRef.current!.getBoundingClientRect();
      setTopPanelPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel]);

  useEffect(() => {
    if (!activeTopPanel) return;
    const tween = revealElement(topPanelDropdownRef.current, { y: -5, duration: 0.18 });
    return () => { tween?.kill(); };
  }, [activeTopPanel]);

  // Right panel — file and controlled-browser tabs
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [browserPanelMaximized, setBrowserPanelMaximized] = useState(false);
  const browserMaxNavigationSnapshotRef = useRef<BrowserMaxNavigationSnapshot | null>(null);
  const [fluidInspectorTier, setFluidInspectorTier] = useState<FluidInspectorTier>(1);
  const [fluidCanUseTierTwo, setFluidCanUseTierTwo] = useState(() => (
    typeof window === "undefined" ? true : window.innerWidth >= FLUID_INSPECTOR_TIER_TWO_MIN_VIEWPORT
  ));
  const fluidInspectorInitializedRef = useRef(false);

  const handleAtMention = useCallback((relativePath: string) => {
    const mention = normalizeExplorerMentionPath(relativePath);
    chatInputRef.current?.insertText(t(mention.projectRelative ? "explorer.insertPathPrompt" : "explorer.insertAbsolutePathPrompt", { path: mention.path }));
  }, [t]);

  const [initialSessionId] = useState<string | null>(() => searchParams.get("session"));
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !searchParams.get("session"));
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);

  const handleCwdChange = useCallback((cwd: string | null) => {
    setActiveCwd(cwd);
    // Skip if cwd is null (initial mount) or during the initial URL restore.
    if (!cwd || suppressCwdBumpRef.current) return;
    // External session selection may synchronize the sidebar to the session cwd.
    // That is not a user-requested workspace change, so keep the session and URL.
    if (selectedSession?.cwd === cwd) return;
    // Close any session that belongs to a different cwd — it no longer
    // matches the selected project directory.
    setSelectedSession((prev) => {
      if (prev && prev.cwd !== cwd) return null;
      return prev;
    });
    setNewSessionCwd((prev) => {
      if (prev && prev !== cwd) return null;
      return prev;
    });
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    router.replace("/", { scroll: false });
  }, [router, selectedSession?.cwd]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setInitialSessionRestored(true);
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
      setTimeout(() => { suppressCwdBumpRef.current = false; }, 0);
    }
    // Skip router.replace when restoring from URL — the param is already correct
    // and calling replace in production Next.js triggers a Suspense remount loop
    if (!isRestore) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [router]);

  const handleNewSession = useCallback((_sessionId: string, cwd: string) => {
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    router.replace("/", { scroll: false });
  }, [router]);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setRefreshKey((k) => k + 1);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [router]);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
  }, []);

  const handleSessionForked = useCallback((newSessionId: string) => {
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
    }));
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [router]);

  const handleSessionImportClick = useCallback(() => {
    setSessionImportError(null);
    setDebugBundleFile(null);
    setDebugBundleSummary(null);
    if (sessionImportInputRef.current) sessionImportInputRef.current.value = "";
    sessionImportInputRef.current?.click();
  }, []);

  const applyImportedSession = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setSelectedSession(session);
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [router]);

  const handleSessionImportFile = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setSessionImporting(true);
    setSessionImportError(null);
    setDebugBundleFile(null);
    setDebugBundleSummary(null);
    try {
      if (isDebugBundleFile(file)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch(apiPath("debug-bundles/inspect"), {
          method: "POST",
          body: form,
        });
        const data = await res.json().catch(() => ({})) as { summary?: DebugBundleSummary; error?: string };
        if (!res.ok || !data.summary) throw new Error(data.error ?? `HTTP ${res.status}`);
        setDebugBundleFile(file);
        setDebugBundleSummary(data.summary);
        return;
      }

      const form = new FormData();
      form.append("file", file);
      const res = await fetch(apiPath("sessions/import"), {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({})) as { session?: SessionInfo; error?: string };
      if (!res.ok || !data.session) throw new Error(data.error ?? `HTTP ${res.status}`);
      applyImportedSession(data.session);
    } catch (error) {
      setSessionImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionImporting(false);
      input.value = "";
    }
  }, [applyImportedSession]);

  const handleDebugBundleImportConfirm = useCallback(async () => {
    if (!debugBundleFile) return;
    setSessionImporting(true);
    setSessionImportError(null);
    try {
      const form = new FormData();
      form.append("file", debugBundleFile);
      form.append("confirm", "1");
      const res = await fetch(apiPath("debug-bundles/import"), {
        method: "POST",
        body: form,
      });
      const data = await res.json().catch(() => ({})) as { session?: SessionInfo; error?: string };
      if (!res.ok || !data.session) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDebugBundleFile(null);
      setDebugBundleSummary(null);
      applyImportedSession(data.session);
    } catch (error) {
      setSessionImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionImporting(false);
    }
  }, [applyImportedSession, debugBundleFile]);

  const handleDebugBundleImportCancel = useCallback(() => {
    setDebugBundleFile(null);
    setDebugBundleSummary(null);
    setSessionImportError(null);
  }, []);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setRefreshKey((k) => k + 1);
    if (selectedSession?.id === sessionId) {
      const cwd = selectedSession.cwd;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setActiveTopPanel(null);
      router.replace("/", { scroll: false });
    }
  }, [selectedSession, router]);

  const handleOpenFile = useCallback((filePath: string, fileName: string) => {
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => {
      if (prev.find((t) => t.id === tabId)) return prev;
      return [...prev, { id: tabId, label: fileName, kind: "file", filePath }];
    });
    setActiveFileTabId(tabId);
    if (isFluid && !rightPanelOpen) setFluidInspectorTier(1);
    setRightPanelOpen(true);
  }, [isFluid, rightPanelOpen]);

  const handleOpenBrowser = useCallback((agentSessionId = selectedSession?.id) => {
    if (!agentSessionId) return;
    const tabId = `browser:${agentSessionId}`;
    setFileTabs((prev) => {
      if (prev.some((tab) => tab.id === tabId)) return prev;
      return [...prev, { id: tabId, label: t("browser.tab"), kind: "browser", agentSessionId, cwd: selectedSession?.cwd || activeCwd || "" }];
    });
    setActiveFileTabId(tabId);
    setRightPanelOpen(true);
    if (isFluid) setFluidInspectorTier(2);
  }, [activeCwd, isFluid, selectedSession?.cwd, selectedSession?.id, t]);

  const handleOpenRemote = useCallback((agentSessionId = selectedSession?.id) => {
    if (!agentSessionId) return;
    const tabId = `remote:${agentSessionId}`;
    setFileTabs((prev) => {
      if (prev.some((tab) => tab.id === tabId)) return prev;
      return [...prev, { id: tabId, label: t("remote.tab"), kind: "remote", agentSessionId, cwd: selectedSession?.cwd || activeCwd || "" }];
    });
    setActiveFileTabId(tabId);
    setRightPanelOpen(true);
    if (isFluid) setFluidInspectorTier(2);
  }, [activeCwd, isFluid, selectedSession?.cwd, selectedSession?.id, t]);

  const handleOpenFileFromSidebar = useCallback((filePath: string, fileName: string) => {
    handleOpenFile(filePath, fileName);
    if (isFluid) setFluidDrawerOpen(false);
  }, [handleOpenFile, isFluid]);

  const handleCloseFileTab = useCallback((tabId: string) => {
    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0) setRightPanelOpen(false);
      return next;
    });
    setActiveFileTabId((cur) => {
      if (cur !== tabId) return cur;
      const remaining = fileTabs.filter((t) => t.id !== tabId);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
    if (tabId === activeFileTabId && (tabId.startsWith("browser:") || tabId.startsWith("remote:"))) setBrowserPanelMaximized(false);
  }, [activeFileTabId, fileTabs]);

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const capabilitiesCwd = activeCwd || selectedSession?.cwd || newSessionCwd || null;
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  const activeFileTab = fileTabs.find((t) => t.id === activeFileTabId) ?? null;
  const interactivePanelIsMaximized = browserPanelMaximized && (activeFileTab?.kind === "browser" || activeFileTab?.kind === "remote");

  const handleToggleBrowserMaximize = useCallback(() => {
    if (browserPanelMaximized) {
      setBrowserPanelMaximized(false);
      return;
    }
    browserMaxNavigationSnapshotRef.current = { sidebarOpen, fluidDrawerOpen };
    setSidebarOpen(false);
    setFluidDrawerOpen(false);
    setActiveTopPanel(null);
    setBrowserPanelMaximized(true);
  }, [browserPanelMaximized, fluidDrawerOpen, sidebarOpen]);

  useEffect(() => {
    if (!selectedSession?.id) return;
    const source = new EventSource(apiPath(`/api/browser/sessions/${encodeURIComponent(selectedSession.id)}/events`));
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { type?: string };
        if (event.type && event.type !== "ready") handleOpenBrowser(selectedSession.id);
      } catch {
        // Ignore malformed/transient SSE messages.
      }
    };
    return () => source.close();
  }, [handleOpenBrowser, selectedSession?.id]);

  useEffect(() => {
    if (!selectedSession?.id) return;
    const source = new EventSource(apiPath(`/api/remote/sessions/${encodeURIComponent(selectedSession.id)}/events`));
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as { type?: string };
        if (event.type && event.type !== "ready") handleOpenRemote(selectedSession.id);
      } catch {
        // Ignore malformed/transient SSE messages.
      }
    };
    return () => source.close();
  }, [handleOpenRemote, selectedSession?.id]);

  useEffect(() => {
    if (activeFileTab?.kind !== "browser" && activeFileTab?.kind !== "remote") setBrowserPanelMaximized(false);
  }, [activeFileTab?.kind]);

  useEffect(() => {
    setBrowserPanelMaximized(false);
  }, [isFluid, selectedSession?.id]);

  useEffect(() => {
    if (browserPanelMaximized) return;
    const snapshot = browserMaxNavigationSnapshotRef.current;
    if (!snapshot) return;
    browserMaxNavigationSnapshotRef.current = null;
    setSidebarOpen(snapshot.sidebarOpen);
    setFluidDrawerOpen(snapshot.fluidDrawerOpen);
  }, [browserPanelMaximized]);

  const effectiveSidebarOpen = isFluid ? fluidDrawerOpen : sidebarOpen;
  const openFluidDrawer = useCallback((view: FluidDrawerView) => {
    if (browserPanelMaximized) return;
    setFluidDrawerView(view);
    setFluidDrawerOpen((open) => !(open && fluidDrawerView === view));
    setActiveTopPanel(null);
  }, [browserPanelMaximized, fluidDrawerView]);

  const formatCompactNumber = useCallback((n: number) => {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
    return String(n);
  }, []);

  const fluidSessionTitle = normalizeHeaderText(selectedSession?.name || selectedSession?.firstMessage || (effectiveNewSessionCwd ? "New session" : APP_NAME)) || APP_NAME;
  const fluidDisplayTitle = truncateFluidTitle(fluidSessionTitle);
  const fluidWorkspaceCwd = selectedSession?.cwd ?? effectiveNewSessionCwd ?? null;
  const fluidWorkspaceLabel = workspaceLabelFromCwd(fluidWorkspaceCwd);
  const fluidTokens = sessionStats?.tokens ?? null;
  const fluidCostText = sessionStats?.cost
    ? sessionStats.cost >= 0.01 ? `$${sessionStats.cost.toFixed(2)}` : "<$0.01"
    : null;
  const fluidContextValue = contextUsage?.contextWindow
    ? `${contextUsage.percent !== null ? `${contextUsage.percent.toFixed(0)}%` : "?"} / ${formatCompactNumber(contextUsage.contextWindow)}`
    : null;
  const fluidContextTone: FluidMetricTone | undefined = contextUsage?.percent !== null && contextUsage?.percent !== undefined
    ? contextUsage.percent > 90
      ? "danger"
      : contextUsage.percent > 70
        ? "warning"
        : undefined
    : undefined;
  const fluidStatsTooltipParts: string[] = [];
  if (fluidTokens) {
    fluidStatsTooltipParts.push(`${t("stats.input")}: ${fluidTokens.input.toLocaleString()}`);
    fluidStatsTooltipParts.push(`${t("stats.output")}: ${fluidTokens.output.toLocaleString()}`);
    fluidStatsTooltipParts.push(`${t("stats.cacheRead")}: ${fluidTokens.cacheRead.toLocaleString()}`);
    fluidStatsTooltipParts.push(`${t("stats.cacheWrite")}: ${fluidTokens.cacheWrite.toLocaleString()}`);
  }
  if (sessionStats?.cost) fluidStatsTooltipParts.push(`${t("stats.cost")}: $${sessionStats.cost.toFixed(4)}`);
  if (contextUsage?.contextWindow) {
    fluidStatsTooltipParts.push(`${t("stats.context")}: ${contextUsage.percent !== null ? `${contextUsage.percent.toFixed(1)}%` : t("stats.unknown")} / ${contextUsage.contextWindow.toLocaleString()}`);
  }
  const fluidStatsTooltip = fluidStatsTooltipParts.length > 0 ? fluidStatsTooltipParts.join("  |  ") : undefined;
  const fluidStatsMetricItems: Array<FluidMetric | null> = [
    fluidTokens && fluidTokens.input > 0 ? {
      key: "input",
      label: "IN",
      value: formatCompactNumber(fluidTokens.input),
      title: `${t("stats.input")}: ${fluidTokens.input.toLocaleString()}`,
    } : null,
    fluidTokens && fluidTokens.output > 0 ? {
      key: "output",
      label: "OUT",
      value: formatCompactNumber(fluidTokens.output),
      title: `${t("stats.output")}: ${fluidTokens.output.toLocaleString()}`,
    } : null,
    fluidTokens && fluidTokens.cacheRead > 0 ? {
      key: "cache",
      label: "CACHE",
      value: formatCompactNumber(fluidTokens.cacheRead),
      tone: "accent",
      title: `${t("stats.cacheRead")}: ${fluidTokens.cacheRead.toLocaleString()}`,
    } : null,
    fluidCostText ? {
      key: "cost",
      label: "COST",
      value: fluidCostText,
      title: `${t("stats.cost")}: ${sessionStats?.cost?.toFixed(4) ?? fluidCostText}`,
    } : null,
    fluidContextValue ? {
      key: "context",
      label: "CTX",
      value: fluidContextValue,
      tone: fluidContextTone,
      title: contextUsage?.contextWindow
        ? `${t("stats.context")}: ${contextUsage.percent !== null ? `${contextUsage.percent.toFixed(1)}%` : t("stats.unknown")} / ${contextUsage.contextWindow.toLocaleString()}`
        : undefined,
    } : null,
  ];
  const fluidStatsMetrics = fluidStatsMetricItems.filter((metric): metric is FluidMetric => Boolean(metric));

  useEffect(() => {
    if (!isFluid || !activeCwd || fluidInspectorInitializedRef.current) return;
    fluidInspectorInitializedRef.current = true;
    setFluidInspectorTier(1);
    setRightPanelOpen(true);
  }, [activeCwd, isFluid]);

  useEffect(() => {
    setActiveTopPanel(null);
    setFluidDrawerOpen(false);
  }, [isFluid]);

  useEffect(() => {
    if (!isFluid || typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(`(min-width: ${FLUID_INSPECTOR_TIER_TWO_MIN_VIEWPORT}px)`);
    const applyTierCapability = (canUseTierTwo: boolean) => {
      setFluidCanUseTierTwo((current) => current === canUseTierTwo ? current : canUseTierTwo);
      if (!canUseTierTwo) setFluidInspectorTier(1);
    };
    const handleChange = (event: MediaQueryListEvent) => {
      applyTierCapability(event.matches);
    };
    applyTierCapability(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [isFluid]);

  const handleRightPanelToggleClick = useCallback(() => {
    if (!isFluid) {
      setRightPanelOpen((open) => !open);
      return;
    }

    const canUseTierTwo = typeof window === "undefined"
      ? fluidCanUseTierTwo
      : window.innerWidth >= FLUID_INSPECTOR_TIER_TWO_MIN_VIEWPORT;

    if (!canUseTierTwo) {
      setFluidInspectorTier(1);
      setRightPanelOpen((open) => !open);
      return;
    }

    if (!rightPanelOpen) {
      setFluidInspectorTier(1);
      setRightPanelOpen(true);
      return;
    }

    if (fluidInspectorTier === 1) {
      setFluidInspectorTier(2);
      return;
    }

    setFluidInspectorTier(1);
    setRightPanelOpen(false);
  }, [fluidCanUseTierTwo, fluidInspectorTier, isFluid, rightPanelOpen]);

  const rightPanelToggleTitle = isFluid
    ? !rightPanelOpen
      ? "Show file panel"
      : fluidCanUseTierTwo && fluidInspectorTier === 1
        ? "Expand file panel"
        : "Hide file panel"
    : rightPanelOpen
      ? "Hide file panel"
      : "Show file panel";
  const showFluidEnvironmentPanel = isFluid && showChat && !rightPanelOpen;

  const railSessionsLabel = t("fluidRail.sessions.label");
  const railSessionsDescription = t("fluidRail.sessions.description");
  const railExplorerLabel = t("fluidRail.explorer.label");
  const railExplorerDescription = t("fluidRail.explorer.description");
  const railContextLabel = t("fluidRail.context.label");
  const railContextDescription = t("fluidRail.context.description");
  const railModelsLabel = t("fluidRail.models.label");
  const railModelsDescription = t("fluidRail.models.description");
  const railCapabilitiesLabel = t("fluidRail.capabilities.label");
  const railCapabilitiesDescription = capabilitiesCwd
    ? t("fluidRail.capabilities.description")
    : t("fluidRail.capabilities.disabledDescription");
  const railThemeLabel = t("fluidRail.theme.label");
  const railThemeDescription = t("fluidRail.theme.description");
  const railUiModeLabel = t("fluidRail.uiMode.label");
  const railUiModeDescription = t("fluidRail.uiMode.description");
  const railLocaleLabel = t("fluidRail.locale.label");
  const railLocaleDescription = t("fluidRail.locale.description");

  const sidebarContent = (!isFluid || !fluidDrawerOpen || fluidDrawerView !== "context") ? (
    <>
      <MemoSessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        initialSessionId={initialSessionId}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onOpenFile={handleOpenFileFromSidebar}
        explorerRefreshKey={explorerRefreshKey}
        onAtMention={handleAtMention}
      />
      {!isFluid && <div className="pi-sidebar-footer" style={{ padding: "8px", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}>
        <ThemeCycleButton variant="footer" />
        <UiModeToggleButton variant="footer" />
        {([
          {
            id: "models",
            label: t("nav.models"),
            shortLabel: t("nav.models"),
            onClick: () => setModelsConfigOpen(true),
            disabled: false,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
                <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
              </svg>
            ),
          },
          {
            id: "capabilities",
            label: t("nav.capabilities"),
            shortLabel: t("nav.capabilitiesShort"),
            onClick: () => setCapabilitiesConfigOpen(true),
            disabled: !capabilitiesCwd,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            ),
          },
        ] as { id: string; label: string; shortLabel: string; onClick: () => void; disabled: boolean; icon: React.ReactNode }[]).map(({ id, label, shortLabel, onClick, disabled, icon }) => (
          <button
            key={id}
            onClick={onClick}
            disabled={disabled}
            title={label}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
              height: 32, minWidth: 0, padding: "0 3px", background: "none", border: "none",
              borderRadius: 8, color: "var(--text-muted)", cursor: disabled ? "default" : "pointer",
              fontSize: 10.5,
              opacity: disabled ? 0.35 : 1,
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {icon}
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortLabel}</span>
          </button>
        ))}
      </div>}
    </>
  ) : null;

  const fluidContextContent = (isFluid && fluidDrawerOpen && fluidDrawerView === "context") ? (
    <div className="pi-fluid-context-drawer">
      <div className="pi-fluid-drawer-heading">
        <div>
          <div className="pi-fluid-drawer-kicker">Context</div>
          <div className="pi-fluid-drawer-title">Session tools</div>
        </div>
        <div className="pi-fluid-context-tabs">
          <button
            type="button"
            className={fluidContextTab === "session" ? "active" : ""}
            onClick={() => setFluidContextTab("session")}
          >
            {t("session.label")}
          </button>
          <button
            type="button"
            className={fluidContextTab === "system" ? "active" : ""}
            onClick={() => setFluidContextTab("system")}
          >
            {t("system.label")}
          </button>
        </div>
      </div>
      {fluidContextTab === "session" ? (
        <div className="pi-fluid-context-section">
          <div className="pi-fluid-context-actions">
            <button
              type="button"
              onClick={handleSessionImportClick}
              disabled={sessionImporting}
            >
              {sessionImporting ? t("session.importing") : t("session.import")}
            </button>
            {selectedSession ? (
              <>
                <a
                  href={apiPath(`sessions/${encodeURIComponent(selectedSession.id)}/export?format=markdown${branchActiveLeafId ? `&leafId=${encodeURIComponent(branchActiveLeafId)}` : ""}`)}
                  download
                >
                  {t("session.exportMarkdown")}
                </a>
                <a
                  href={apiPath(`sessions/${encodeURIComponent(selectedSession.id)}/export?format=json${branchActiveLeafId ? `&leafId=${encodeURIComponent(branchActiveLeafId)}` : ""}`)}
                  download
                >
                  {t("session.exportJson")}
                </a>
                <a
                  href={apiPath(`sessions/${encodeURIComponent(selectedSession.id)}/debug-bundle`)}
                  download
                >
                  {t("session.exportDebugBundle")}
                </a>
              </>
            ) : (
              <span className="pi-fluid-context-muted">{t("branches.noSession")}</span>
            )}
          </div>
          {sessionImportError && (
            <div className="pi-fluid-context-error">{t("session.importFailed")}: {sessionImportError}</div>
          )}
          {debugBundleSummary && (
            <div className="pi-fluid-debug-summary">
              <div className="pi-fluid-debug-title">{t("session.debugBundleReady")}</div>
              <div>{t("session.debugBundleTargetCwd")}: <span>{debugBundleSummary.targetCwd}</span></div>
              <div>
                {t("session.debugBundleContents", {
                  files: debugBundleSummary.fileCount,
                  fileBytes: formatBytes(debugBundleSummary.fileBytes),
                  media: debugBundleSummary.mediaCount,
                  mediaBytes: formatBytes(debugBundleSummary.mediaBytes),
                })}
              </div>
              <div className="pi-fluid-context-actions">
                <button type="button" onClick={() => void handleDebugBundleImportConfirm()} disabled={sessionImporting}>
                  {sessionImporting ? t("session.importing") : t("session.debugBundleImport")}
                </button>
                <button type="button" onClick={handleDebugBundleImportCancel} disabled={sessionImporting}>
                  {t("session.debugBundleCancel")}
                </button>
              </div>
            </div>
          )}
          {fluidWorkspaceCwd && (
            <AgentsMdStatus cwd={fluidWorkspaceCwd} variant="context" />
          )}
          <div className="pi-fluid-branch-block">
            <div className="pi-fluid-section-label">{t("session.branches")}</div>
            <BranchNavigator
              sessionId={selectedSession?.id ?? null}
              tree={branchTree}
              activeLeafId={branchActiveLeafId}
              onLeafChange={handleBranchLeafChange}
              hasSession={Boolean(selectedSession)}
              panelOnly
            />
          </div>
        </div>
      ) : (
        <div className="pi-fluid-system-block">
          {systemPrompt ? (
            <pre>{systemPrompt}</pre>
          ) : systemPrompt === "" ? (
            <div className="pi-fluid-context-muted">{t("system.emptyTools")}</div>
          ) : (
            <div className="pi-fluid-context-muted">{t("system.loadHint")}</div>
          )}
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
    <input
      ref={sessionImportInputRef}
      type="file"
      accept=".json,.jsonl,.tar.gz,.tgz,application/json,application/x-ndjson,application/gzip"
      onChange={handleSessionImportFile}
      style={{ display: "none" }}
    />
    <div
      className={`pi-app-shell${isFluid ? " pi-fluid-shell" : " pi-classic-shell"}${interactivePanelIsMaximized ? " pi-browser-focus-mode" : ""}${activeFileTab?.kind === "remote" ? " pi-remote-active" : ""}`}
      style={{ display: "flex", height: "100dvh", overflow: "hidden", background: "var(--bg)" }}
    >
      {/* Mobile overlay backdrop */}
      <div
        className="sidebar-overlay-backdrop"
        onClick={() => isFluid ? setFluidDrawerOpen(false) : setSidebarOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.4)",
          opacity: effectiveSidebarOpen ? 1 : 0,
          pointerEvents: effectiveSidebarOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {isFluid && (
        <div className="pi-fluid-rail" aria-label="Fluid command rail">
          <div className="pi-fluid-rail-brand" title={APP_NAME}>π</div>
          <FluidRailHint label={railSessionsLabel} description={railSessionsDescription}>
            <button
              className={`pi-fluid-rail-button${fluidDrawerOpen && fluidDrawerView === "sessions" ? " pi-fluid-rail-button-active" : ""}`}
              type="button"
              title={`${railSessionsLabel}: ${railSessionsDescription}`}
              aria-label={`${railSessionsLabel}: ${railSessionsDescription}`}
              onClick={() => openFluidDrawer("sessions")}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a4 4 0 0 1-4 4H7l-4 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
              </svg>
            </button>
          </FluidRailHint>
          <FluidRailHint label={railExplorerLabel} description={railExplorerDescription}>
            <button
              className={`pi-fluid-rail-button${fluidDrawerOpen && fluidDrawerView === "explorer" ? " pi-fluid-rail-button-active" : ""}`}
              type="button"
              onClick={() => openFluidDrawer("explorer")}
              title={`${railExplorerLabel}: ${railExplorerDescription}`}
              aria-label={`${railExplorerLabel}: ${railExplorerDescription}`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20h16" />
                <path d="M12 4v12" />
                <path d="m7 9 5-5 5 5" />
              </svg>
            </button>
          </FluidRailHint>
          <FluidRailHint label={railContextLabel} description={railContextDescription}>
            <button
              className={`pi-fluid-rail-button${fluidDrawerOpen && fluidDrawerView === "context" ? " pi-fluid-rail-button-active" : ""}`}
              type="button"
              onClick={() => openFluidDrawer("context")}
              title={`${railContextLabel}: ${railContextDescription}`}
              aria-label={`${railContextLabel}: ${railContextDescription}`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M8 13h8" />
                <path d="M8 17h5" />
              </svg>
            </button>
          </FluidRailHint>
          <FluidRailHint label={railModelsLabel} description={railModelsDescription}>
            <button
              className="pi-fluid-rail-button"
              type="button"
              onClick={() => setModelsConfigOpen(true)}
              title={`${railModelsLabel}: ${railModelsDescription}`}
              aria-label={`${railModelsLabel}: ${railModelsDescription}`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <rect x="9" y="9" width="6" height="6" />
                <path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3" />
              </svg>
            </button>
          </FluidRailHint>
          <FluidRailHint label={railCapabilitiesLabel} description={railCapabilitiesDescription}>
            <button
              className="pi-fluid-rail-button"
              type="button"
              onClick={() => setCapabilitiesConfigOpen(true)}
              disabled={!capabilitiesCwd}
              title={`${railCapabilitiesLabel}: ${railCapabilitiesDescription}`}
              aria-label={`${railCapabilitiesLabel}: ${railCapabilitiesDescription}`}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="m12 2 9 5-9 5-9-5 9-5Z" />
                <path d="m3 12 9 5 9-5" />
                <path d="m3 17 9 5 9-5" />
              </svg>
            </button>
          </FluidRailHint>
          <div className="pi-fluid-rail-spacer" />
          <FluidRailHint label={railThemeLabel} description={railThemeDescription}>
            <ThemeCycleButton variant="rail" />
          </FluidRailHint>
          <FluidRailHint label={railUiModeLabel} description={railUiModeDescription}>
            <UiModeToggleButton />
          </FluidRailHint>
          <FluidRailHint label={railLocaleLabel} description={railLocaleDescription}>
            <LocaleToggleButton />
          </FluidRailHint>
        </div>
      )}

      {/* Left sidebar */}
      <div
        className={`sidebar-container pi-sidebar${isFluid ? " pi-fluid-drawer" : ""}${effectiveSidebarOpen ? " sidebar-open" : " sidebar-closed"}`}
        style={{
          background: "var(--bg-panel)",
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          zIndex: 200,
        }}
      >
        {isFluid && (
          <div className="pi-fluid-drawer-bar">
            <div>
              <div className="pi-fluid-drawer-kicker">
                {fluidDrawerView === "context" ? "Context" : fluidDrawerView === "explorer" ? "Workspace" : "Navigation"}
              </div>
              <div className="pi-fluid-drawer-title">
                {fluidDrawerView === "context" ? "Session & System" : fluidDrawerView === "explorer" ? "Sessions & Explorer" : "Sessions"}
              </div>
            </div>
            <button type="button" onClick={() => setFluidDrawerOpen(false)} title={t("sidebar.hide")}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
        )}
        {isFluid && fluidDrawerView === "context" ? fluidContextContent : sidebarContent}
      </div>

      {/* Center: chat */}
      <div className={`pi-center-pane${isFluid ? " pi-fluid-workspace" : ""}${showFluidEnvironmentPanel ? " pi-fluid-info-visible" : ""}`} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Top bar with sidebar toggle */}
        {!isFluid ? <div ref={topBarRef} className="pi-topbar" style={{ display: "flex", alignItems: "center", flexShrink: 0, borderBottom: "1px solid var(--border)", height: 36, background: "var(--bg-panel)" }}>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? t("sidebar.hide") : t("sidebar.show")}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, padding: 0,
              background: "none", border: "none", borderRight: "1px solid var(--border)",
              color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {sidebarOpen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
          {!isFluid && <ThemeCycleButton />}
          {!isFluid && <UiModeToggleButton />}
          {!isFluid && <LocaleToggleButton />}
          {showChat && (
            <div style={{ display: "flex", alignItems: "stretch", height: "100%" }}>
              <button
                className="pi-topbar-command"
                onClick={() => toggleTopPanel("session")}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  height: "100%", padding: "0 12px",
                  background: activeTopPanel === "session" ? "var(--bg-selected)" : "none",
                  border: "none",
                  borderTop: activeTopPanel === "session" ? "2px solid var(--accent)" : "2px solid transparent",
                  borderRight: "1px solid var(--border)",
                  cursor: "pointer",
                  color: activeTopPanel === "session" ? "var(--text)" : "var(--text-muted)",
                  fontSize: 11, whiteSpace: "nowrap", transition: "color 0.1s, background 0.1s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = activeTopPanel === "session" ? "var(--text)" : "var(--text-muted)"; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: selectedSession ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <path d="M8 13h8" />
                  <path d="M8 17h5" />
                </svg>
                <span>{isFluid ? t("session.label") : t("session.label")}</span>
              </button>
              <button
                className="pi-topbar-command"
                ref={systemBtnRef}
                onClick={() => toggleTopPanel("system")}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  height: "100%", padding: "0 12px",
                  background: activeTopPanel === "system" ? "var(--bg-selected)" : "none",
                  border: "none",
                  borderTop: activeTopPanel === "system" ? "2px solid var(--accent)" : "2px solid transparent",
                  borderRight: "1px solid var(--border)",
                  cursor: "pointer",
                  color: activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)",
                  fontSize: 11, whiteSpace: "nowrap", transition: "color 0.1s, background 0.1s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)"; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: systemPrompt ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="8" y1="13" x2="16" y2="13" />
                  <line x1="8" y1="17" x2="13" y2="17" />
                </svg>
                <span>{t("system.label")}</span>
              </button>
            </div>
          )}
          {showChat && !isFluid && <TopBarTypewriter />}
          {/* Session stats — right-aligned in top bar */}
          {showChat && (sessionStats || contextUsage) && (() => {
            const tokens = sessionStats?.tokens;
            const c = sessionStats?.cost ?? 0;
            const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
            const costStr = c > 0 ? (c >= 0.01 ? `$${c.toFixed(2)}` : `<$0.01`) : null;

            let ctxColor = "var(--text-muted)";
            let ctxStr: string | null = null;
            if (contextUsage?.contextWindow) {
              const pct = contextUsage.percent;
              if (pct !== null && pct > 90) ctxColor = "#ef4444";
              else if (pct !== null && pct > 70) ctxColor = "rgba(234,179,8,0.95)";
              ctxStr = pct !== null ? `${pct.toFixed(0)}% / ${fmt(contextUsage.contextWindow)}` : `? / ${fmt(contextUsage.contextWindow)}`;
            }

            const tooltipParts: string[] = [];
            if (tokens) {
              tooltipParts.push(`${t("stats.input")}: ${tokens.input.toLocaleString()}`);
              tooltipParts.push(`${t("stats.output")}: ${tokens.output.toLocaleString()}`);
              tooltipParts.push(`${t("stats.cacheRead")}: ${tokens.cacheRead.toLocaleString()}`);
              tooltipParts.push(`${t("stats.cacheWrite")}: ${tokens.cacheWrite.toLocaleString()}`);
              if (c > 0) tooltipParts.push(`${t("stats.cost")}: $${c.toFixed(4)}`);
            }
            if (contextUsage?.contextWindow) {
              const pct = contextUsage.percent;
              tooltipParts.push(`${t("stats.context")}: ${pct !== null ? pct.toFixed(1) + "%" : t("stats.unknown")} of ${contextUsage.contextWindow.toLocaleString()} tokens`);
            }
            const tooltip = tooltipParts.join("  |  ");

            return (
              <div
                title={tooltip}
                style={{
                  marginLeft: "auto",
                  display: "flex", alignItems: "center", gap: 10,
                  paddingLeft: 12,
                  paddingRight: rightPanelOpen ? 12 : 48,
                  height: "100%",
                  fontSize: 11, color: "var(--text-muted)",
                  whiteSpace: "nowrap", cursor: "default",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {tokens && tokens.input > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="8.5" x2="5" y2="1.5" /><polyline points="2 4 5 1.5 8 4" />
                    </svg>
                    {fmt(tokens.input)}
                  </span>
                )}
                {tokens && tokens.output > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                    </svg>
                    {fmt(tokens.output)}
                  </span>
                )}
                {tokens && tokens.cacheRead > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8.5 5a3.5 3.5 0 1 1-1-2.45" /><polyline points="6.5 1.5 8.5 2.5 7.5 4.5" />
                    </svg>
                    {fmt(tokens.cacheRead)}
                  </span>
                )}
                {costStr && (
                  <span style={{ display: "flex", alignItems: "center", color: "var(--text)", fontWeight: 500 }}>
                    {costStr}
                  </span>
                )}
                {ctxStr && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4, color: ctxColor }}>
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 9 L1 5 Q1 1 5 1 Q9 1 9 5 L9 9" /><line x1="1" y1="9" x2="9" y2="9" />
                    </svg>
                    {ctxStr}
                  </span>
                )}
              </div>
            );
          })()}
          {/* Top panel dropdown — shared, only one active at a time */}
          {activeTopPanel && topPanelPos && (
            <div ref={topPanelDropdownRef} className="pi-top-dropdown" style={{
              position: "fixed",
              top: topPanelPos.top,
              left: topPanelPos.left,
              width: topPanelPos.width,
              zIndex: 500,
            }}>
              {activeTopPanel === "session" && (
                <div style={{
                  background: "var(--bg-panel)",
                  borderBottom: "1px solid var(--border)",
                  boxShadow: "0 10px 28px rgba(0,0,0,0.12)",
                }}>
                  <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                    padding: "10px 16px",
                    borderBottom: "1px solid var(--border)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--text)", fontSize: 12, fontWeight: 650 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--accent)" }}>
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      {t("session.exportTitle")}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <button
                        type="button"
                        onClick={handleSessionImportClick}
                        disabled={sessionImporting}
                        style={{
                          ...sessionImportButtonStyle,
                          opacity: sessionImporting ? 0.6 : 1,
                        }}
                      >
                        {sessionImporting ? t("session.importing") : t("session.import")}
                      </button>
                      {selectedSession ? (
                        <>
                          <a
                            href={apiPath(`sessions/${encodeURIComponent(selectedSession.id)}/export?format=markdown${branchActiveLeafId ? `&leafId=${encodeURIComponent(branchActiveLeafId)}` : ""}`)}
                            download
                            onClick={() => setActiveTopPanel(null)}
                            style={sessionExportLinkStyle}
                          >
                            {t("session.exportMarkdown")}
                          </a>
                          <a
                            href={apiPath(`sessions/${encodeURIComponent(selectedSession.id)}/export?format=json${branchActiveLeafId ? `&leafId=${encodeURIComponent(branchActiveLeafId)}` : ""}`)}
                            download
                            onClick={() => setActiveTopPanel(null)}
                            style={sessionExportLinkStyle}
                          >
                            {t("session.exportJson")}
                          </a>
                          <a
                            href={apiPath(`sessions/${encodeURIComponent(selectedSession.id)}/debug-bundle`)}
                            download
                            onClick={() => setActiveTopPanel(null)}
                            style={sessionExportLinkStyle}
                          >
                            {t("session.exportDebugBundle")}
                          </a>
                        </>
                      ) : (
                        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>{t("branches.noSession")}</span>
                      )}
                    </div>
                  </div>
                  {sessionImportError && (
                    <div style={{
                      padding: "7px 16px",
                      borderBottom: "1px solid var(--border)",
                      color: "var(--danger)",
                      fontSize: 12,
                    }}>
                      {t("session.importFailed")}: {sessionImportError}
                    </div>
                  )}
                  {debugBundleSummary && (
                    <div style={{
                      padding: "9px 16px",
                      borderBottom: "1px solid var(--border)",
                      color: "var(--text-muted)",
                      fontSize: 12,
                      display: "grid",
                      gap: 7,
                    }}>
                      <div style={{ color: "var(--text)", fontWeight: 650 }}>{t("session.debugBundleReady")}</div>
                      <div style={{ display: "grid", gap: 4 }}>
                        <div>{t("session.debugBundleOriginalCwd")}: <span style={{ fontFamily: "var(--font-mono)" }}>{debugBundleSummary.manifest?.source?.cwd ?? "-"}</span></div>
                        <div>{t("session.debugBundleTargetCwd")}: <span style={{ fontFamily: "var(--font-mono)" }}>{debugBundleSummary.targetCwd}</span></div>
                        <div>
                          {t("session.debugBundleContents", {
                            files: debugBundleSummary.fileCount,
                            fileBytes: formatBytes(debugBundleSummary.fileBytes),
                            media: debugBundleSummary.mediaCount,
                            mediaBytes: formatBytes(debugBundleSummary.mediaBytes),
                          })}
                        </div>
                        {debugBundleSummary.manifest?.workspace?.excluded?.length ? (
                          <div>
                            {t("session.debugBundleExcluded", { count: debugBundleSummary.manifest.workspace.excluded.length })}
                          </div>
                        ) : null}
                        {debugBundleSummary.warnings?.slice(0, 3).map((warning, idx) => (
                          <div key={`debug-warning:${idx}`} style={{ color: "rgba(234,179,8,0.98)" }}>
                            {warning}
                          </div>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => void handleDebugBundleImportConfirm()}
                          disabled={sessionImporting}
                          style={{ ...sessionImportButtonStyle, opacity: sessionImporting ? 0.6 : 1 }}
                        >
                          {sessionImporting ? t("session.importing") : t("session.debugBundleImport")}
                        </button>
                        <button
                          type="button"
                          onClick={handleDebugBundleImportCancel}
                          disabled={sessionImporting}
                          style={{ ...sessionImportButtonStyle, opacity: sessionImporting ? 0.6 : 1 }}
                        >
                          {t("session.debugBundleCancel")}
                        </button>
                      </div>
                    </div>
                  )}
                  <div style={{ paddingTop: 1 }}>
                    <div style={{ padding: "8px 16px 4px", fontSize: 10, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0 }}>
                      {t("session.branches")}
                    </div>
                    <BranchNavigator
                      sessionId={selectedSession?.id ?? null}
                      tree={branchTree}
                      activeLeafId={branchActiveLeafId}
                      onLeafChange={handleBranchLeafChange}
                      hasSession={Boolean(selectedSession)}
                      panelOnly
                    />
                  </div>
                </div>
              )}
              {activeTopPanel === "system" && (
                <div style={{
                  background: "var(--bg-panel)",
                  borderBottom: "1px solid var(--border)",
                }}>
                  {systemPrompt ? (
                    <div style={{
                      maxHeight: "min(600px, 75vh)",
                      overflowY: "auto",
                      padding: "12px 16px",
                      color: "var(--text-muted)",
                      fontSize: 12,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      fontFamily: "var(--font-mono)",
                    }}>
                      {systemPrompt}
                    </div>
                  ) : systemPrompt === "" ? (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                      {t("system.emptyTools")}
                    </div>
                  ) : (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                      {t("system.loadHint")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

        </div> : (
          <div ref={topBarRef} className="pi-fluid-workspace-header">
            <div className="pi-fluid-workspace-status" title={fluidWorkspaceCwd ?? undefined}>
              <span
                className={`pi-fluid-status-dot pi-fluid-status-${taskStatus}`}
                aria-label={TASK_STATUS_META[taskStatus].label}
              />
              <span
                className="pi-fluid-workspace-project-wrap"
                title={fluidWorkspaceCwd ?? undefined}
                aria-label={fluidWorkspaceCwd ? t("fluidHeader.cwdLabel", { path: fluidWorkspaceCwd }) : fluidWorkspaceLabel}
                tabIndex={fluidWorkspaceCwd ? 0 : undefined}
              >
                <span
                  className="pi-fluid-workspace-project"
                  title={fluidWorkspaceCwd ?? undefined}
                  aria-label={fluidWorkspaceCwd ? t("fluidHeader.cwdLabel", { path: fluidWorkspaceCwd }) : fluidWorkspaceLabel}
                >
                  {fluidWorkspaceLabel}
                </span>
                {fluidWorkspaceCwd && (
                  <span className="pi-fluid-workspace-path-tooltip" role="tooltip" aria-hidden="true">
                    {fluidWorkspaceCwd}
                  </span>
                )}
              </span>
            </div>
            <div className="pi-fluid-workspace-title">
              <div className="pi-fluid-workspace-title-line">
                <span
                  className="pi-fluid-workspace-name"
                  title={fluidSessionTitle}
                  aria-label={`Session: ${fluidSessionTitle}`}
                >
                  {fluidDisplayTitle}
                </span>
                {selectedSession && (
                  <FluidSessionTypewriter
                    active={taskStatus === "done" && !composerActivity.focused && !composerActivity.hasDraft}
                    resetKey={selectedSession.id}
                  />
                )}
              </div>
            </div>
            <div className="pi-fluid-workspace-meta" title={fluidStatsTooltip}>
              {fluidStatsMetrics.map((metric) => (
                <span
                  key={metric.key}
                  className={`pi-fluid-metric${metric.tone ? ` pi-fluid-metric-${metric.tone}` : ""}`}
                  data-kind={metric.key}
                  title={metric.title ?? fluidStatsTooltip}
                >
                  <span className="pi-fluid-metric-label">{metric.label}</span>
                  <span className="pi-fluid-metric-value">{metric.value}</span>
                </span>
              ))}
              {fluidStatsMetrics.length === 0 && (
                <span className="pi-fluid-meta-fallback">{selectedSession ? `${selectedSession.messageCount} messages` : "Ready"}</span>
              )}
            </div>
          </div>
        )}

        {/* Chat content */}
        <div className={`pi-chat-region${isFluid ? " pi-fluid-workspace-body" : ""}`} style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {showChat ? (
            <ChatWindow
              key={sessionKey}
              session={selectedSession}
              newSessionCwd={effectiveNewSessionCwd}
              onAgentEnd={handleAgentEnd}
              onSessionCreated={handleSessionCreated}
              onSessionForked={handleSessionForked}
              modelsRefreshKey={modelsRefreshKey}
              chatInputRef={chatInputRef}
              onBranchDataChange={handleBranchDataChange}
              onSystemPromptChange={handleSystemPromptChange}
              onSessionStatsChange={handleSessionStatsChange}
              onContextUsageChange={handleContextUsageChange}
              onTaskStatusChange={handleTaskStatusChange}
              onComposerActivityChange={handleComposerActivityChange}
            />
          ) : showPlaceholder ? (
            activeCwd ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 15 }}>
                {t("placeholder.selectSession")}
              </div>
            ) : (
              <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "flex-start", gap: 8, userSelect: "none", pointerEvents: "none" }}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, flexShrink: 0 }}>
                  <line x1="20" y1="12" x2="4" y2="12" /><polyline points="10 6 4 12 10 18" />
                </svg>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>{t("placeholder.getStarted")}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>{t("placeholder.stepSelectProject")}<br />
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>{t("placeholder.stepAddModels")}
                  </div>
                </div>
              </div>
            )
          ) : null}
          {showFluidEnvironmentPanel && (
            <FluidEnvironmentPanel
              cwd={fluidWorkspaceCwd}
              workspaceLabel={fluidWorkspaceLabel}
              sessionTitle={fluidSessionTitle}
              displayTitle={fluidDisplayTitle}
              taskStatus={taskStatus}
              sessionStats={sessionStats}
              contextUsage={contextUsage}
              refreshKey={refreshKey}
              onOpenFilePanel={handleRightPanelToggleClick}
            />
          )}
        </div>
      </div>

      {/* Right panel: file viewer — always mounted, width animated via CSS */}
      <div
        className={`right-panel-container ${isFluid ? `pi-fluid-inspector pi-fluid-inspector-tier-${fluidInspectorTier}` : "pi-right-panel"}${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}${activeFileTab?.kind === "browser" || activeFileTab?.kind === "remote" ? " pi-browser-panel-active" : ""}${activeFileTab?.kind === "remote" ? " pi-remote-panel-active" : ""}${interactivePanelIsMaximized ? " pi-browser-panel-maximized" : ""}`}
        style={{
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        {/* Right panel tab bar */}
        <div className="pi-right-panel-header" style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 36 }}>
          <div style={{ flex: 1, overflow: "hidden" }}>
            <TabBar
              tabs={fileTabs}
              activeTabId={activeFileTabId ?? ""}
              onSelectTab={(tabId) => {
                setActiveFileTabId(tabId);
                const tab = fileTabs.find((candidate) => candidate.id === tabId);
                if (isFluid && (tab?.kind === "browser" || tab?.kind === "remote")) setFluidInspectorTier(2);
              }}
              onCloseTab={handleCloseFileTab}
            />
          </div>
          <button
            className="pi-browser-open-tab"
            onClick={() => handleOpenBrowser()}
            disabled={!selectedSession}
            title={selectedSession ? t("browser.openTab") : t("browser.requiresSession")}
            aria-label={selectedSession ? t("browser.openTab") : t("browser.requiresSession")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
            </svg>
          </button>
          <button
            className="pi-browser-open-tab"
            onClick={() => handleOpenRemote()}
            disabled={!selectedSession}
            title={selectedSession ? t("remote.openTab") : t("remote.requiresSession")}
            aria-label={selectedSession ? t("remote.openTab") : t("remote.requiresSession")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="m7 9 3 3-3 3M13 15h4" />
            </svg>
          </button>
        </div>

        {/* File or controlled-browser content */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          {activeFileTab?.kind === "file" ? (
            <FileViewer filePath={activeFileTab.filePath} cwd={activeCwd ?? undefined} />
          ) : activeFileTab?.kind === "browser" ? (
            <BrowserPanel
              agentSessionId={activeFileTab.agentSessionId}
              cwd={activeFileTab.cwd}
              maximized={interactivePanelIsMaximized}
              onToggleMaximize={handleToggleBrowserMaximize}
              onCloseTab={() => handleCloseFileTab(activeFileTab.id)}
            />
          ) : activeFileTab?.kind === "remote" ? (
            <RemotePanel
              agentSessionId={activeFileTab.agentSessionId}
              cwd={activeFileTab.cwd}
              maximized={interactivePanelIsMaximized}
              onToggleMaximize={handleToggleBrowserMaximize}
              onCloseTab={() => handleCloseFileTab(activeFileTab.id)}
            />
          ) : isFluid ? (
            <div className="pi-fluid-inspector-empty">
              <div className="pi-fluid-inspector-empty-icon">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                  <path d="M8 13h8" />
                  <path d="M8 17h5" />
                </svg>
              </div>
              <div className="pi-fluid-inspector-empty-title">未打开文件</div>
              <div className="pi-fluid-inspector-empty-text">从左侧 Explorer 打开文件</div>
            </div>
          ) : (
            <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
              {t("file.noOpen")}
            </div>
          )}
        </div>
      </div>
      {isFluid && !interactivePanelIsMaximized && (
        <button
          className="pi-fluid-dock-handle"
          onClick={handleRightPanelToggleClick}
          title={rightPanelToggleTitle}
          aria-label={rightPanelToggleTitle}
          aria-pressed={rightPanelOpen}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="15" y1="3" x2="15" y2="21" />
          </svg>
        </button>
      )}
    </div>
    {/* File panel toggle — always visible at top-right */}
    {!isFluid && !interactivePanelIsMaximized && <button
      className="pi-right-panel-toggle"
      onClick={handleRightPanelToggleClick}
      title={rightPanelToggleTitle}
      aria-label={rightPanelToggleTitle}
      aria-pressed={rightPanelOpen}
      style={{
        position: "fixed", top: 0, right: 0, zIndex: 300,
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 36, height: 36, padding: 0,
        background: "var(--bg-panel)", border: "none", borderLeft: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
        color: rightPanelOpen ? "var(--text)" : "var(--text-muted)",
        cursor: "pointer", transition: "color 0.12s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = rightPanelOpen ? "var(--text)" : "var(--text-muted)"; }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="15" y1="3" x2="15" y2="21" />
      </svg>
    </button>}
    {modelsConfigOpen && <ModelsConfig onClose={() => { setModelsConfigOpen(false); setModelsRefreshKey((k) => k + 1); }} />}
    <QuickChatPanel
      activeCwd={activeCwd}
      modelsRefreshKey={modelsRefreshKey}
      onOpenModels={() => setModelsConfigOpen(true)}
      onPromoted={applyImportedSession}
    />
    {capabilitiesConfigOpen && capabilitiesCwd && (
      <CapabilitiesConfig
        cwd={capabilitiesCwd}
        onClose={() => setCapabilitiesConfigOpen(false)}
      />
    )}
    </>
  );
}
