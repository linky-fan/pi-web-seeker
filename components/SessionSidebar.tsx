"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { APP_NAME } from "@/lib/branding";
import { useLocale } from "@/lib/i18n";
import type { SessionInfo } from "@/lib/types";
import { getPathRelativeToRoot } from "@/lib/path-identity";
import { apiPath } from "@/lib/api-path";
import { popOnce, revealChildren, revealElement, rotateOnce } from "@/lib/motion";
import { FileExplorer } from "./FileExplorer";

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null) => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  explorerRefreshKey?: number;
  onAtMention?: (relativePath: string) => void;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

/** Return the 5 most recently active cwds across all sessions */
function getRecentCwds(sessions: SessionInfo[]): string[] {
  const latestByCwd = new Map<string, string>(); // cwd -> most recent modified
  for (const s of sessions) {
    if (!s.cwd) continue;
    const prev = latestByCwd.get(s.cwd);
    if (!prev || s.modified > prev) {
      latestByCwd.set(s.cwd, s.modified);
    }
  }
  return [...latestByCwd.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .slice(0, 5)
    .map(([cwd]) => cwd);
}

function shortenCwd(cwd: string, homeDir?: string): string {
  const rel = homeDir ? getPathRelativeToRoot(cwd, homeDir) : null;
  const displayPath = rel !== null ? (rel ? `~/${rel}` : "~") : cwd;
  const sep = displayPath.includes("/") ? "/" : "\\";
  const parts = displayPath.split(sep).filter(Boolean);
  if (parts.length <= 2) return displayPath;
  return `…${sep}${parts.slice(-2).join(sep)}`;
}



interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

interface WorkspaceDirectoryEntry {
  name: string;
  path: string;
}

interface WorkspaceDirectoryResponse {
  path?: string;
  parent?: string | null;
  roots?: string[];
  entries?: WorkspaceDirectoryEntry[];
  cwd?: string;
  error?: string;
}

function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const s of sessions) {
    byId.set(s.id, { session: s, children: [] });
  }

  // Build a map of parentSessionId chains so we can resolve missing ancestors
  const parentOf = new Map<string, string>();
  for (const s of sessions) {
    if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId);
  }

  // Walk up the parentSessionId chain to find the nearest ancestor that exists in byId
  function resolveAncestor(id: string): string | null {
    let cur = parentOf.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur)) return null; // cycle guard
      visited.add(cur);
      if (byId.has(cur)) return cur;
      cur = parentOf.get(cur);
    }
    return null;
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) {
      byId.get(ancestor)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort each level by modified desc
  const sort = (nodes: SessionTreeNode[]) => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

function AppTitle() {
  const titleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tween = revealElement(titleRef.current, { y: -3, duration: 0.24 });
    return () => { tween?.kill(); };
  }, []);

  return (
    <div
      ref={titleRef}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 7,
        minWidth: 0,
        color: "var(--text)",
      }}
      title={APP_NAME}
    >
      <span
        aria-hidden="true"
        style={{
          display: "grid",
          placeItems: "center",
          width: 26,
          height: 26,
          borderRadius: 6,
          background: "color-mix(in srgb, var(--accent) 14%, var(--bg))",
          border: "1px solid color-mix(in srgb, var(--accent) 32%, var(--border))",
          color: "var(--accent)",
          fontSize: 16,
          fontWeight: 800,
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        π
      </span>
      <span
        style={{
          minWidth: 0,
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
          fontFamily: "var(--font-mono)",
          fontWeight: 800,
          fontSize: 14,
          letterSpacing: 0,
        }}
      >
        Seeker
      </span>
    </div>
  );
}

export function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, initialSessionId, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onOpenFile, explorerRefreshKey, onAtMention }: Props) {
  const { t } = useLocale();
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  const [defaultCwd, setDefaultCwd] = useState<string | null>(null);
  const [singleWorkspace, setSingleWorkspace] = useState(false);
  const [runtimePlatform, setRuntimePlatform] = useState<string>("");
  const [nativeDirectoryPicker, setNativeDirectoryPicker] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [directoryBrowserOpen, setDirectoryBrowserOpen] = useState(false);
  const [directoryBrowserPath, setDirectoryBrowserPath] = useState<string | null>(null);
  const [directoryEntries, setDirectoryEntries] = useState<WorkspaceDirectoryEntry[]>([]);
  const [directoryParent, setDirectoryParent] = useState<string | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [nativePickerLoading, setNativePickerLoading] = useState(false);
  const customPathInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerKey, setExplorerKey] = useState(0);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const dropdownMenuRef = useRef<HTMLDivElement>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);
  const sessionRefreshButtonRef = useRef<HTMLButtonElement>(null);
  const explorerRefreshButtonRef = useRef<HTMLButtonElement>(null);
  const explorerContentRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const res = await fetch(apiPath("sessions"));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { sessions: SessionInfo[] };
      setAllSessions(data.sessions);
      setError(null);
      if (!showLoading) {
        setSessionRefreshDone(true);
        if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
        sessionRefreshTimerRef.current = setTimeout(() => setSessionRefreshDone(false), 2000);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    loadSessions(isFirst);
  }, [loadSessions, refreshKey]);

  useEffect(() => {
    const tween = revealElement(headerRef.current, { y: -4, duration: 0.24 });
    return () => { tween?.kill(); };
  }, []);

  useEffect(() => {
    if (sessionRefreshDone) popOnce(sessionRefreshButtonRef.current);
  }, [sessionRefreshDone]);

  useEffect(() => {
    if (explorerRefreshDone) popOnce(explorerRefreshButtonRef.current);
  }, [explorerRefreshDone]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  useEffect(() => {
    fetch(apiPath("home")).then((r) => r.json()).then((d: { home?: string; defaultCwd?: string | null; singleWorkspace?: boolean; platform?: string; nativeDirectoryPicker?: boolean }) => {
      if (d.home) setHomeDir(d.home);
      if (d.defaultCwd) setDefaultCwd(d.defaultCwd);
      setSingleWorkspace(!!d.singleWorkspace);
      setRuntimePlatform(d.platform ?? "");
      const localHost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" || window.location.hostname === "::1";
      setNativeDirectoryPicker(!!d.nativeDirectoryPicker && localHost);
    }).catch(() => {});
  }, []);

  const restoredRef = useRef(false);

  useEffect(() => {
    onCwdChange?.(selectedCwd);
  }, [selectedCwd, onCwdChange]);

  // Session selection can originate outside the sidebar (for example, importing
  // or promoting a quick chat). Keep the workspace selector aligned with it.
  useEffect(() => {
    if (!selectedSessionId || !selectedCwdProp) return;
    setSelectedCwd((current) => current === selectedCwdProp ? current : selectedCwdProp);
  }, [selectedCwdProp, selectedSessionId]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        if (loading) return;
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      const cwds = singleWorkspace && defaultCwd ? [defaultCwd] : getRecentCwds(allSessions);
      if (cwds.length > 0) setSelectedCwd(cwds[0]);
    }
  }, [allSessions, selectedCwd, initialSessionId, onSelectSession, onInitialRestoreDone, loading, singleWorkspace, defaultCwd]);

  const resetDirectoryPicker = useCallback(() => {
    setCustomPathOpen(false);
    setCustomPathValue("");
    setPathError(null);
    setDirectoryBrowserOpen(false);
    setDirectoryBrowserPath(null);
    setDirectoryEntries([]);
    setDirectoryParent(null);
    setDirectoryLoading(false);
    setNativePickerLoading(false);
  }, []);

  const selectWorkspaceDirectory = useCallback(async (cwd: string) => {
    setPathError(null);
    const res = await fetch(apiPath("workspaces"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd }),
    });
    const data = await res.json() as WorkspaceDirectoryResponse;
    if (!res.ok || !data.cwd) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }
    setSelectedCwd(data.cwd);
    setDropdownOpen(false);
    resetDirectoryPicker();
  }, [resetDirectoryPicker]);

  const loadWorkspaceDirectory = useCallback(async (dirPath?: string | null) => {
    setDirectoryLoading(true);
    setPathError(null);
    try {
      const query = dirPath ? `?path=${encodeURIComponent(dirPath)}` : "";
      const res = await fetch(apiPath(`workspaces${query}`));
      const data = await res.json() as WorkspaceDirectoryResponse;
      if (!res.ok || !data.path) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setDirectoryBrowserPath(data.path);
      setDirectoryParent(data.parent ?? null);
      setDirectoryEntries(data.entries ?? []);
    } catch (e) {
      setPathError(String(e));
    } finally {
      setDirectoryLoading(false);
    }
  }, []);

  const openDirectoryBrowser = useCallback(() => {
    setCustomPathOpen(false);
    setCustomPathValue("");
    setDirectoryBrowserOpen(true);
    void loadWorkspaceDirectory((selectedCwd ?? defaultCwd ?? homeDir) || undefined);
  }, [defaultCwd, homeDir, loadWorkspaceDirectory, selectedCwd]);

  const commitCustomPath = useCallback(async () => {
    const path = customPathValue.trim();
    if (!path) return;
    try {
      await selectWorkspaceDirectory(path);
    } catch (e) {
      setPathError(String(e));
    }
  }, [customPathValue, selectWorkspaceDirectory]);

  const openNativeDirectoryPicker = useCallback(async () => {
    setNativePickerLoading(true);
    setPathError(null);
    try {
      const res = await fetch(apiPath("workspaces/pick"), { method: "POST" });
      const data = await res.json() as WorkspaceDirectoryResponse & { cancelled?: boolean };
      if (data.cancelled) return;
      if (!res.ok || !data.cwd) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSelectedCwd(data.cwd);
      setDropdownOpen(false);
      resetDirectoryPicker();
    } catch (e) {
      setPathError(String(e));
    } finally {
      setNativePickerLoading(false);
    }
  }, [resetDirectoryPicker]);

  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await fetch(apiPath("default-cwd"), { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      if (data.cwd) {
        setSelectedCwd(data.cwd);
        setDropdownOpen(false);
        resetDirectoryPicker();
      }
    } catch {
      // ignore
    }
  }, [resetDirectoryPicker]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        resetDirectoryPicker();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [resetDirectoryPicker]);

  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    // Generate a temporary UUID client-side — no backend call needed.
    // Pi will be spawned lazily when the user sends the first message.
    const tempId = typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    onNewSession?.(tempId, selectedCwd);
  }, [selectedCwd, onNewSession]);

  const recentCwds = singleWorkspace && defaultCwd ? [defaultCwd] : getRecentCwds(allSessions);
  const filteredSessions = selectedCwd
    ? allSessions.filter((s) => s.cwd === selectedCwd)
    : allSessions;

  // Build parent-child tree within the filtered set
  const sessionTree = buildSessionTree(filteredSessions);

  useEffect(() => {
    if (!dropdownOpen) return;
    const menuTween = revealElement(dropdownMenuRef.current, { y: -4, scale: 0.985, duration: 0.18 });
    const itemTween = revealChildren(dropdownMenuRef.current, "[data-motion-menu-item]", {
      y: 3,
      limit: 12,
      stagger: 0.018,
      duration: 0.18,
    });
    return () => {
      menuTween?.kill();
      itemTween?.kill();
    };
  }, [dropdownOpen, recentCwds.length, customPathOpen, directoryBrowserOpen]);

  useEffect(() => {
    if (loading || error) return;
    const tween = revealChildren(sessionListRef.current, "[data-motion-session-item]", {
      y: 4,
      limit: 20,
      stagger: 0.016,
      duration: 0.18,
    });
    return () => { tween?.kill(); };
  }, [loading, error, selectedCwd, sessionRefreshDone, sessionTree.length]);

  useEffect(() => {
    if (!explorerOpen) return;
    const tween = revealElement(explorerContentRef.current, { y: 4, duration: 0.18 });
    return () => { tween?.kill(); };
  }, [explorerOpen, selectedCwdProp, selectedCwd]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div
        ref={headerRef}
        style={{
          padding: "10px 10px 9px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
          <AppTitle />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={handleNewSession}
              disabled={!selectedCwd}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                background: selectedCwd ? "color-mix(in srgb, var(--accent) 12%, var(--bg))" : "var(--bg-hover)",
                border: `1px solid ${selectedCwd ? "color-mix(in srgb, var(--accent) 30%, var(--border))" : "var(--border)"}`,
                color: selectedCwd ? "var(--accent)" : "var(--text-dim)",
                cursor: selectedCwd ? "pointer" : "not-allowed",
                height: 30,
                paddingLeft: 9,
                paddingRight: 10,
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 650,
                letterSpacing: 0,
                flexShrink: 0,
                transition: "background 0.14s, color 0.14s, border-color 0.14s, transform 0.12s",
              }}
              title={selectedCwd ? `New session in ${selectedCwd}` : "Select a project first"}
              onMouseEnter={(e) => {
                if (!selectedCwd) return;
                e.currentTarget.style.background = "color-mix(in srgb, var(--accent) 18%, var(--bg))";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.borderColor = "color-mix(in srgb, var(--accent) 42%, var(--border))";
                e.currentTarget.style.transform = "translateY(-1px)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = selectedCwd ? "color-mix(in srgb, var(--accent) 12%, var(--bg))" : "var(--bg-hover)";
                e.currentTarget.style.color = selectedCwd ? "var(--accent)" : "var(--text-dim)";
                e.currentTarget.style.borderColor = selectedCwd ? "color-mix(in srgb, var(--accent) 30%, var(--border))" : "var(--border)";
                e.currentTarget.style.transform = "translateY(0)";
              }}
              onMouseDown={(e) => {
                if (selectedCwd) e.currentTarget.style.transform = "translateY(1px)";
              }}
              onMouseUp={(e) => {
                if (selectedCwd) e.currentTarget.style.transform = "translateY(-1px)";
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="6" y1="1" x2="6" y2="11" />
                <line x1="1" y1="6" x2="11" y2="6" />
              </svg>
              New
            </button>
            <button
              ref={sessionRefreshButtonRef}
              onClick={() => {
                rotateOnce(sessionRefreshButtonRef.current);
                void loadSessions(false);
              }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                background: sessionRefreshDone ? "rgba(74,222,128,0.16)" : "transparent",
                border: `1px solid ${sessionRefreshDone ? "rgba(74,222,128,0.4)" : "var(--border)"}`,
                color: sessionRefreshDone ? "#4ade80" : "var(--text-muted)",
                cursor: "pointer",
                width: 30, height: 30,
                borderRadius: 6,
                padding: 0,
                flexShrink: 0,
                transition: "background 0.22s, color 0.22s, border-color 0.22s",
              }}
              onMouseEnter={(e) => {
                if (sessionRefreshDone) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
              }}
              onMouseLeave={(e) => {
                if (sessionRefreshDone) return;
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
              title="Refresh"
            >
              {sessionRefreshDone ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* CWD picker */}
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => {
              if (!singleWorkspace) setDropdownOpen((v) => !v);
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "6px 8px",
              background: selectedCwd ? "transparent" : "rgba(37,99,235,0.06)",
              border: selectedCwd ? "1px solid color-mix(in srgb, var(--border) 72%, transparent)" : "1px solid rgba(37,99,235,0.4)",
              borderRadius: 6,
              cursor: singleWorkspace ? "default" : "pointer",
              fontSize: 12,
              color: "var(--text)",
              textAlign: "left",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" style={{ color: selectedCwd ? "var(--text-dim)" : "var(--accent)", flexShrink: 0 }}>
              <path d="M1.5 4A1 1 0 0 1 2.5 3h2l1 1.3h4A1 1 0 0 1 10.5 5.3V9a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V4Z" />
            </svg>
            <span
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: selectedCwd ? "var(--text)" : "var(--text-dim)",
              }}
              title={selectedCwd ?? ""}
            >
              {selectedCwd ? shortenCwd(selectedCwd, homeDir) : (initialSessionId && !restoredRef.current ? "" : "Select project…")}
            </span>
            {!singleWorkspace && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)", transform: dropdownOpen ? "rotate(180deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}>
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            )}
          </button>

          {dropdownOpen && !singleWorkspace && (
            <div
              ref={dropdownMenuRef}
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                zIndex: 100,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
                overflow: "hidden",
              }}
            >
              {recentCwds.map((cwd) => (
                <button
                  key={cwd}
                  data-motion-menu-item
                  onClick={() => {
                    setSelectedCwd(cwd);
                    setDropdownOpen(false);
                    resetDirectoryPicker();
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    padding: "8px 10px",
                    background: cwd === selectedCwd ? "var(--bg-selected)" : "none",
                    border: "none",
                    borderBottom: "1px solid var(--border)",
                    color: cwd === selectedCwd ? "var(--text)" : "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={cwd}
                >
                  {cwd === selectedCwd && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                      <polyline points="1.5 5 4 7.5 8.5 2.5" />
                    </svg>
                  )}
                  {cwd !== selectedCwd && <span style={{ width: 10, flexShrink: 0 }} />}
                  <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortenCwd(cwd, homeDir)}</span>
                </button>
              ))}

              {/* Default cwd shortcut */}
              {!customPathOpen && !singleWorkspace && (
                <button
                  data-motion-menu-item
                  onClick={(e) => { e.stopPropagation(); handleDefaultCwd(); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    padding: "8px 10px",
                    background: "none",
                    border: "none",
                    borderTop: recentCwds.length > 0 ? "1px solid var(--border)" : "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
                  </svg>
                  <span>{t("sidebar.useDefaultDirectory")}</span>
                </button>
              )}

              {nativeDirectoryPicker && !customPathOpen && !directoryBrowserOpen && !singleWorkspace && (
                <button
                  data-motion-menu-item
                  onClick={(e) => {
                    e.stopPropagation();
                    void openNativeDirectoryPicker();
                  }}
                  disabled={nativePickerLoading}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    padding: "8px 10px",
                    background: "none",
                    border: "none",
                    color: nativePickerLoading ? "var(--text-dim)" : "var(--text-muted)",
                    cursor: nativePickerLoading ? "wait" : "pointer",
                    textAlign: "left",
                    fontSize: 11,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <rect x="1.2" y="2" width="7.6" height="6.8" rx="1" />
                    <path d="M3 4.2h4M3 6h2.8" />
                  </svg>
                  <span>
                    {nativePickerLoading
                      ? t("sidebar.openingDirectoryPicker")
                      : runtimePlatform === "darwin"
                        ? t("sidebar.chooseInFinder")
                        : t("sidebar.chooseInExplorer")}
                  </span>
                </button>
              )}

              {!customPathOpen && !directoryBrowserOpen && !singleWorkspace && (
                <button
                  data-motion-menu-item
                  onClick={(e) => {
                    e.stopPropagation();
                    openDirectoryBrowser();
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    padding: "8px 10px",
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M1 3A1 1 0 0 1 2 2h2l1 1.5h3A1 1 0 0 1 9 4.5V8a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V3Z" />
                    <path d="M4 6h3M5.5 4.5v3" />
                  </svg>
                  <span>{t("sidebar.browseDirectories")}</span>
                </button>
              )}

              {directoryBrowserOpen && !singleWorkspace && (
                <div style={{ padding: "7px 8px", borderTop: "1px solid var(--border)" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                      marginBottom: 6,
                    }}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (directoryParent) void loadWorkspaceDirectory(directoryParent);
                      }}
                      disabled={!directoryParent || directoryLoading}
                      title={t("sidebar.parentDirectory")}
                      style={{
                        width: 26,
                        height: 24,
                        display: "grid",
                        placeItems: "center",
                        flexShrink: 0,
                        border: "1px solid var(--border)",
                        borderRadius: 5,
                        background: "var(--bg-hover)",
                        color: directoryParent ? "var(--text-muted)" : "var(--text-dim)",
                        cursor: directoryParent && !directoryLoading ? "pointer" : "not-allowed",
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M6 9V3" />
                        <path d="M3.5 5.5 6 3l2.5 2.5" />
                      </svg>
                    </button>
                    <div
                      title={directoryBrowserPath ?? ""}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--text-dim)",
                        border: "1px solid var(--border)",
                        borderRadius: 5,
                        padding: "5px 7px",
                      }}
                    >
                      {directoryBrowserPath ?? t("sidebar.loadingDirectories")}
                    </div>
                  </div>

                  <div
                    style={{
                      maxHeight: 190,
                      overflowY: "auto",
                      border: "1px solid var(--border)",
                      borderRadius: 5,
                      background: "var(--bg)",
                    }}
                  >
                    {directoryLoading && (
                      <div style={{ padding: "8px", fontSize: 11, color: "var(--text-dim)" }}>
                        {t("sidebar.loadingDirectories")}
                      </div>
                    )}
                    {!directoryLoading && directoryEntries.map((entry) => (
                      <button
                        key={entry.path}
                        onClick={(e) => {
                          e.stopPropagation();
                          void loadWorkspaceDirectory(entry.path);
                        }}
                        title={entry.path}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 7,
                          width: "100%",
                          height: 26,
                          padding: "0 8px",
                          border: "none",
                          borderBottom: "1px solid var(--border)",
                          background: "none",
                          color: "var(--text-muted)",
                          cursor: "pointer",
                          textAlign: "left",
                          fontSize: 11,
                          fontFamily: "var(--font-mono)",
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <path d="M1.5 4A1 1 0 0 1 2.5 3h2l1 1.3h4A1 1 0 0 1 10.5 5.3V9a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V4Z" />
                        </svg>
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {entry.name}
                        </span>
                      </button>
                    ))}
                    {!directoryLoading && directoryEntries.length === 0 && (
                      <div style={{ padding: "8px", fontSize: 11, color: "var(--text-dim)" }}>
                        {t("sidebar.noDirectories")}
                      </div>
                    )}
                  </div>

                  {pathError && (
                    <div style={{ marginTop: 6, color: "#f87171", fontSize: 10, lineHeight: 1.35 }}>
                      {pathError}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 5, marginTop: 6 }}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (directoryBrowserPath) void selectWorkspaceDirectory(directoryBrowserPath).catch((err) => setPathError(String(err)));
                      }}
                      disabled={!directoryBrowserPath || directoryLoading}
                      style={{
                        flex: 1,
                        padding: "5px 0",
                        background: directoryBrowserPath && !directoryLoading ? "var(--accent)" : "var(--bg-panel)",
                        border: "none",
                        borderRadius: 5,
                        color: directoryBrowserPath && !directoryLoading ? "#fff" : "var(--text-dim)",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: directoryBrowserPath && !directoryLoading ? "pointer" : "not-allowed",
                      }}
                    >
                      {t("sidebar.selectDirectory")}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        resetDirectoryPicker();
                      }}
                      style={{
                        flex: 1,
                        padding: "5px 0",
                        background: "var(--bg-hover)",
                        border: "1px solid var(--border)",
                        borderRadius: 5,
                        color: "var(--text-muted)",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              )}

              {/* Custom path entry */}
              {!customPathOpen && !directoryBrowserOpen && !singleWorkspace ? (
                <button
                  data-motion-menu-item
                  onClick={(e) => {
                    e.stopPropagation();
                    setCustomPathOpen(true);
                    setPathError(null);
                    setTimeout(() => customPathInputRef.current?.focus(), 0);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    padding: "8px 10px",
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
                    <line x1="5" y1="1" x2="5" y2="9" />
                    <line x1="1" y1="5" x2="9" y2="5" />
                  </svg>
                  <span>{t("sidebar.customPath")}</span>
                </button>
              ) : !singleWorkspace ? (
                <div style={{ padding: "6px 8px", borderTop: recentCwds.length > 0 ? "none" : undefined }}>
                  <input
                    ref={customPathInputRef}
                    value={customPathValue}
                    onChange={(e) => setCustomPathValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitCustomPath();
                      if (e.key === "Escape") {
                        setCustomPathOpen(false);
                        setCustomPathValue("");
                        setPathError(null);
                      }
                    }}
                    placeholder="/path/to/project"
                    style={{
                      width: "100%",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      padding: "5px 8px",
                      border: "1px solid var(--accent)",
                      borderRadius: 5,
                      outline: "none",
                      background: "var(--bg)",
                      color: "var(--text)",
                      boxSizing: "border-box",
                    }}
                  />
                  {pathError && (
                    <div style={{ marginTop: 5, color: "#f87171", fontSize: 10, lineHeight: 1.35 }}>
                      {pathError}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                    <button
                      onClick={() => void commitCustomPath()}
                      style={{
                        flex: 1,
                        padding: "4px 0",
                        background: "var(--accent)",
                        border: "none",
                        borderRadius: 5,
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {t("sidebar.open")}
                    </button>
                    <button
                      onClick={() => { setCustomPathOpen(false); setCustomPathValue(""); setPathError(null); }}
                      style={{
                        flex: 1,
                        padding: "4px 0",
                        background: "var(--bg-hover)",
                        border: "1px solid var(--border)",
                        borderRadius: 5,
                        color: "var(--text-muted)",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {/* Session list */}
      <div ref={sessionListRef} className="pi-session-list" style={{ flex: explorerOpen && (selectedCwdProp || selectedCwd) ? "1 1 0" : "1 1 auto", overflowY: "auto", padding: "0", minHeight: 80 }}>
        {loading && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            Loading...
          </div>
        )}
        {error && (
          <div style={{ padding: "12px 14px", color: "#f87171", fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && filteredSessions.length === 0 && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            No sessions found
          </div>
        )}
        {sessionTree.map((node) => (
          <SessionTreeItem
            key={node.session.id}
            node={node}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
            onRenamed={loadSessions}
            onSessionDeleted={(id) => {
              onSessionDeleted?.(id);
              loadSessions();
            }}
            depth={0}
          />
        ))}
      </div>

      {/* File Explorer section */}
      {(selectedCwdProp || selectedCwd) && (
        <div
          className="pi-sidebar-explorer-section"
          style={{
            borderTop: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flex: explorerOpen ? "1 1 0" : "0 0 auto",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0, minHeight: 34 }}>
            <button
              onClick={() => setExplorerOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                padding: "7px 10px",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 0,
                textAlign: "left",
              }}
            >
              <svg
                width="9" height="9" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: explorerOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
              >
                <polyline points="3 2 7 5 3 8" />
              </svg>
              Explorer
            </button>
            <button
              onClick={() => {
                rotateOnce(explorerRefreshButtonRef.current);
                setExplorerKey((k) => k + 1);
                setExplorerRefreshDone(true);
                if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
                explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
              }}
              ref={explorerRefreshButtonRef}
              title="Refresh explorer"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 26, padding: 0, marginRight: 6,
                background: explorerRefreshDone ? "rgba(74,222,128,0.18)" : "none",
                border: "none",
                color: explorerRefreshDone ? "#4ade80" : "var(--text-dim)",
                cursor: "pointer",
                borderRadius: 5,
                flexShrink: 0,
                transition: "color 0.3s, background 0.3s",
              }}
              onMouseEnter={(e) => { if (explorerRefreshDone) return; e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (explorerRefreshDone) return; e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
            >
              {explorerRefreshDone ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              )}
            </button>
          </div>
          {explorerOpen && (
            <div ref={explorerContentRef} style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
              <FileExplorer
                cwd={selectedCwdProp ?? selectedCwd!}
                onOpenFile={onOpenFile ?? (() => {})}
                refreshKey={explorerKey}
                onAtMention={onAtMention}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionTreeItem({
  node,
  selectedSessionId,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  depth,
}: {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  depth: number;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div style={{ position: "relative" }}>
        {/* Indent line for child sessions */}
        {depth > 0 && (
          <div style={{
            position: "absolute",
            left: depth * 12 + 6,
            top: 0, bottom: 0,
            width: 1,
            background: "var(--border)",
            pointerEvents: "none",
          }} />
        )}
        <SessionItem
          session={node.session}
          isSelected={node.session.id === selectedSessionId}
          onClick={() => onSelectSession(node.session)}
          onRenamed={onRenamed}
          onDeleted={(id) => onSessionDeleted?.(id)}
          depth={depth}
          hasChildren={hasChildren}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child) => (
            <SessionTreeItem
              key={child.session.id}
              node={child}
              selectedSessionId={selectedSessionId}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionItem({
  session,
  isSelected,
  onClick,
  onRenamed,
  onDeleted,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
}: {
  session: SessionInfo;
  isSelected: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const { t } = useLocale();
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const title = session.name || session.firstMessage.slice(0, 50) || session.id.slice(0, 12);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(session.name ?? "");
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [session.name]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (name === (session.name ?? "")) return;
    try {
      await fetch(apiPath(`sessions/${encodeURIComponent(session.id)}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  }, []);

  const handleDeleteConfirm = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await fetch(apiPath(`sessions/${encodeURIComponent(session.id)}`), { method: "DELETE" });
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, onDeleted]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  const ITEM_HEIGHT = 54;

  return (
    <div
      className={`pi-session-item${isSelected ? " pi-session-item-selected" : ""}${confirmDelete ? " pi-session-item-danger" : ""}`}
      data-motion-session-item
      onClick={confirmDelete || renaming ? undefined : onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        height: ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: depth > 0 ? depth * 12 + 14 : 14,
        paddingRight: 8,
        cursor: confirmDelete || renaming ? "default" : "pointer",
        background: confirmDelete
          ? "rgba(239,68,68,0.06)"
          : isSelected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderLeft: confirmDelete
          ? "2px solid #ef4444"
          : isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "background 0.14s ease, border-color 0.14s ease, opacity 0.14s ease",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t("sidebar.deleteConfirm", { title: title.slice(0, 22) + (title.length > 22 ? "..." : "") })}
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={handleDeleteConfirm}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                height: 30, padding: "0 11px",
                background: "#ef4444", border: "none",
                borderRadius: 6, color: "#fff",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              {t("common.delete")}
            </button>
            <button
              onClick={handleDeleteCancel}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 30, padding: "0 11px",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text-muted)",
                cursor: "pointer", fontSize: 12, fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </>
      ) : renaming ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          style={{
            flex: 1,
            fontSize: 12,
            padding: "5px 8px",
            border: "1px solid var(--accent)",
            borderRadius: 5,
            outline: "none",
            background: "var(--bg)",
            color: "var(--text)",
            height: 30,
          }}
        />
      ) : (
        /* ── Normal view ── */
        <>
          {/* Fork indicator for child sessions */}
          {depth > 0 && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: isSelected ? 500 : 400,
                lineHeight: 1.4,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "var(--text)",
              }}
              title={title}
            >
              {title}
            </div>
            <div style={{ marginTop: 2, display: "flex", gap: 8, color: "var(--text-dim)", fontSize: 11 }}>
              <span title={session.modified}>{formatRelativeTime(session.modified)}</span>
              <span>{session.messageCount} msgs</span>
            </div>
          </div>

          {/* Collapse toggle — always visible when has children */}
          {hasChildren && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
              title={collapsed ? "Expand forks" : "Collapse forks"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 20, height: 20, padding: 0, flexShrink: 0,
                background: "none", border: "none",
                color: "var(--text-dim)", cursor: "pointer",
                transform: collapsed ? "rotate(-90deg)" : "none",
                transition: "transform 0.15s",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
          )}

          {/* Action buttons — shown on hover */}
          {hovered && (
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button
                onClick={startRename}
                title="Rename"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, padding: 0,
                  background: "var(--bg-hover)", border: "1px solid var(--border)",
                  borderRadius: 7, color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-selected)";
                  e.currentTarget.style.color = "var(--accent)";
                  e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
              <button
                onClick={handleDeleteClick}
                title="Delete"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, padding: 0,
                  background: "var(--bg-hover)", border: "1px solid var(--border)",
                  borderRadius: 7, color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                  e.currentTarget.style.color = "#ef4444";
                  e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
