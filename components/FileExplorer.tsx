"use client";

import { useState, useCallback, useEffect, useMemo, useRef, type CSSProperties } from "react";
import { getFileIcon, FolderIcon } from "./FileIcons";
import { encodeFilePathForApi, getRelativeFilePath, joinFilePath } from "@/lib/file-paths";
import { useLocale } from "@/lib/i18n";
import { isPathInOrEqualToRoot } from "@/lib/path-identity";
import { apiPath } from "@/lib/api-path";

interface FileEntry {
  name: string;
  isDir: boolean;
  size: number;
  modified: string;
  path?: string;
}

interface FileNode {
  name: string;
  fullPath: string;
  isDir: boolean;
  size: number;
  children?: FileNode[];
  loaded?: boolean;
}

interface Props {
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  refreshKey?: number;
  onAtMention?: (relativePath: string) => void;
}

interface FetchOptions {
  force?: boolean;
  trackedOnly?: boolean;
  search?: string;
}

interface RecentFile {
  filePath: string;
  name: string;
  openedAt: number;
}

const EXPLORER_CACHE_LIMIT = 300;
const RECENT_FILES_KEY = "pi-web.explorer.recent-files";
const TRACKED_MODE_KEY = "pi-web.explorer.tracked-only";
const RECENT_LIMIT = 12;

const directoryCache = new Map<string, FileNode[]>();

function cacheKey(dirPath: string, trackedOnly: boolean): string {
  return `${trackedOnly ? "tracked" : "all"}:${dirPath}`;
}

function readRecentFiles(): RecentFile[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RECENT_FILES_KEY) ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is RecentFile => (
        typeof item?.filePath === "string" &&
        typeof item?.name === "string" &&
        typeof item?.openedAt === "number"
      ))
      : [];
  } catch {
    return [];
  }
}

function writeRecentFiles(files: RecentFile[]): void {
  try {
    window.localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(files.slice(0, RECENT_LIMIT)));
  } catch {
    // localStorage can be unavailable in restricted contexts
  }
}

function getFileDownloadUrl(filePath: string): string {
  return apiPath(`files/${encodeFilePathForApi(filePath)}?type=download`);
}

async function fetchEntries(dirPath: string, options: FetchOptions = {}): Promise<{ nodes: FileNode[]; gitTrackedAvailable?: boolean }> {
  const encoded = encodeFilePathForApi(dirPath);
  const params = new URLSearchParams({ type: options.search !== undefined ? "search" : "list" });
  if (options.trackedOnly) params.set("tracked", "1");
  if (options.force) params.set("refresh", String(Date.now()));
  if (options.search !== undefined) params.set("q", options.search);

  const key = cacheKey(dirPath, Boolean(options.trackedOnly));
  if (!options.force && options.search === undefined) {
    const cached = directoryCache.get(key);
    if (cached) return { nodes: cached };
  }

  const res = await fetch(apiPath(`files/${encoded}?${params.toString()}`));
  if (!res.ok) return { nodes: [] };
  const data = await res.json() as { entries?: FileEntry[]; gitTrackedAvailable?: boolean };
  const nodes = (data.entries ?? []).map((e) => ({
    name: e.name,
    fullPath: e.path ? joinFilePath(dirPath, e.path) : joinFilePath(dirPath, e.name),
    isDir: e.isDir,
    size: e.size,
    children: e.isDir ? [] : undefined,
    loaded: !e.isDir,
  }));
  if (options.search === undefined) {
    directoryCache.set(key, nodes);
    if (directoryCache.size > EXPLORER_CACHE_LIMIT) {
      const oldestKey = directoryCache.keys().next().value as string | undefined;
      if (oldestKey) directoryCache.delete(oldestKey);
    }
  }
  return { nodes, gitTrackedAvailable: data.gitTrackedAvailable };
}

function TreeNode({
  node,
  depth,
  cwd,
  onOpenFile,
  onAtMention,
  expandedPaths,
  onToggleExpanded,
  refreshKey,
  trackedOnly,
}: {
  node: FileNode;
  depth: number;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  onAtMention?: (relativePath: string) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (fullPath: string, open: boolean) => void;
  refreshKey?: number;
  trackedOnly: boolean;
}) {
  const { t } = useLocale();
  const open = expandedPaths.has(node.fullPath);
  const [children, setChildren] = useState<FileNode[]>(node.children ?? []);
  const [loaded, setLoaded] = useState(node.loaded ?? false);
  const [loading, setLoading] = useState(false);
  const [hovered, setHovered] = useState(false);

  const loadChildren = useCallback(async (force = false) => {
    if (loaded && !force) return;
    setLoading(true);
    try {
      const { nodes } = await fetchEntries(node.fullPath, { force, trackedOnly });
      setChildren(nodes);
      setLoaded(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [loaded, node.fullPath, trackedOnly]);

  // Re-fetch children when refreshKey changes and the directory is already open/loaded
  useEffect(() => {
    if (open && loaded) {
      loadChildren(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const handleClick = useCallback(() => {
    if (node.isDir) {
      const next = !open;
      onToggleExpanded(node.fullPath, next);
      if (next && !loaded) loadChildren();
    } else {
      onOpenFile(node.fullPath, node.name);
    }
  }, [node.isDir, node.fullPath, node.name, loaded, open, loadChildren, onOpenFile, onToggleExpanded]);

  return (
    <div>
      <div
        className={`pi-file-row${open ? " pi-file-row-open" : ""}`}
        onClick={handleClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: 4,
          paddingLeft: 8 + depth * 14,
          paddingRight: 8,
          height: 24,
          cursor: "pointer",
          background: hovered ? "var(--bg-hover)" : "transparent",
          borderRadius: 4,
          userSelect: "none",
        }}
      >
        {node.isDir && (
          <svg
            width="10" height="10" viewBox="0 0 10 10" fill="none"
            stroke="var(--text-dim)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.1s" }}
          >
            <polyline points="3 2 7 5 3 8" />
          </svg>
        )}
        {!node.isDir && <span style={{ width: 10, flexShrink: 0 }} />}
        <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
          {node.isDir ? <FolderIcon size={14} open={open} /> : getFileIcon(node.name, 14)}
        </span>
        <span
          style={{
            fontSize: 12,
            color: "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
          title={node.fullPath}
        >
          {node.name}
        </span>
        {loading && (
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round">
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4" />
          </svg>
        )}
        {!node.isDir && (
          <FileRowActions
            filePath={node.fullPath}
            fileName={node.name}
            cwd={cwd}
            visible={hovered}
            onAtMention={onAtMention}
          />
        )}
      </div>
      {node.isDir && open && (
        <div>
          {children.map((child) => (
            <TreeNode key={`${trackedOnly ? "tracked" : "all"}:${child.fullPath}`} node={child} depth={depth + 1} cwd={cwd} onOpenFile={onOpenFile} onAtMention={onAtMention} expandedPaths={expandedPaths} onToggleExpanded={onToggleExpanded} refreshKey={refreshKey} trackedOnly={trackedOnly} />
          ))}
          {children.length === 0 && loaded && (
            <div style={{ paddingLeft: 8 + (depth + 1) * 14, fontSize: 11, color: "var(--text-dim)", height: 22, display: "flex", alignItems: "center" }}>
              {t("explorer.empty")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FileExplorer({ cwd, onOpenFile, refreshKey, onAtMention }: Props) {
  const { t } = useLocale();
  const [roots, setRoots] = useState<FileNode[]>([]);
  const [searchResults, setSearchResults] = useState<FileNode[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [trackedOnly, setTrackedOnly] = useState(false);
  const [gitTrackedAvailable, setGitTrackedAvailable] = useState<boolean | undefined>(undefined);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const prevCwdRef = useRef<string | null>(null);
  const prevRefreshKeyRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    setRecentFiles(readRecentFiles());
    try {
      setTrackedOnly(window.localStorage.getItem(TRACKED_MODE_KEY) === "1");
    } catch {
      // ignore storage failures
    }
  }, []);

  const visibleRecentFiles = useMemo(() => (
    trackedOnly ? [] : recentFiles
      .filter((file) => isPathInOrEqualToRoot(file.filePath, cwd))
      .slice(0, 5)
  ), [cwd, recentFiles, trackedOnly]);

  const rememberOpenFile = useCallback((filePath: string, fileName: string) => {
    setRecentFiles((prev) => {
      const next = [
        { filePath, name: fileName, openedAt: Date.now() },
        ...prev.filter((item) => item.filePath !== filePath),
      ].slice(0, RECENT_LIMIT);
      writeRecentFiles(next);
      return next;
    });
  }, []);

  const handleOpenFile = useCallback((filePath: string, fileName: string) => {
    rememberOpenFile(filePath, fileName);
    onOpenFile(filePath, fileName);
  }, [onOpenFile, rememberOpenFile]);

  const toggleTrackedOnly = useCallback(() => {
    setTrackedOnly((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(TRACKED_MODE_KEY, next ? "1" : "0");
      } catch {
        // ignore storage failures
      }
      return next;
    });
  }, []);

  const handleToggleExpanded = useCallback((fullPath: string, open: boolean) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (open) next.add(fullPath); else next.delete(fullPath);
      return next;
    });
  }, []);

  useEffect(() => {
    const cwdChanged = prevCwdRef.current !== cwd;
    const refreshChanged = prevRefreshKeyRef.current !== undefined && prevRefreshKeyRef.current !== refreshKey;
    prevCwdRef.current = cwd;
    prevRefreshKeyRef.current = refreshKey;

    // Reset expanded state only when cwd changes, not on refreshKey bumps
    if (cwdChanged) setExpandedPaths(new Set());

    setLoading(cwdChanged);
    setError(null);
    fetchEntries(cwd, { force: !cwdChanged && refreshChanged, trackedOnly })
      .then(({ nodes, gitTrackedAvailable }) => {
        setRoots(nodes);
        setGitTrackedAvailable(gitTrackedAvailable);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [cwd, refreshKey, trackedOnly]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    let alive = true;
    setSearching(true);
    const timer = setTimeout(() => {
      fetchEntries(cwd, { trackedOnly, search: query })
        .then(({ nodes, gitTrackedAvailable }) => {
          if (!alive) return;
          setSearchResults(nodes);
          setGitTrackedAvailable(gitTrackedAvailable);
        })
        .catch(() => {
          if (alive) setSearchResults([]);
        })
        .finally(() => {
          if (alive) setSearching(false);
        });
    }, 180);

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [cwd, searchQuery, trackedOnly]);

  if (loading) {
    return (
      <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>
        {t("explorer.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: "8px 12px", fontSize: 11, color: "#f87171" }}>
        {error}
      </div>
    );
  }

  return (
    <div className="pi-file-explorer" style={{ padding: "4px" }}>
      <div className="pi-file-explorer-search" style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 0 4px" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ position: "absolute", left: 7, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}>
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t("explorer.search")}
            style={{
              width: "100%",
              height: 26,
              padding: "0 8px 0 24px",
              borderRadius: 5,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text)",
              fontSize: 12,
              outline: "none",
              minWidth: 0,
            }}
          />
        </div>
        <button
          onClick={toggleTrackedOnly}
          title={trackedOnly ? t("explorer.showAll") : t("explorer.trackedOnly")}
          style={{
            width: 30,
            height: 26,
            flexShrink: 0,
            border: `1px solid ${trackedOnly ? "var(--accent)" : "var(--border)"}`,
            borderRadius: 5,
            background: trackedOnly ? "rgba(96,165,250,0.12)" : "var(--bg)",
            color: trackedOnly ? "var(--accent)" : "var(--text-dim)",
            cursor: "pointer",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0,
          }}
        >
          git
        </button>
      </div>

      {trackedOnly && gitTrackedAvailable === false && (
        <div style={{ padding: "4px 6px 6px", fontSize: 11, color: "var(--text-dim)" }}>
          {t("explorer.notGit")}
        </div>
      )}

      {searchQuery.trim() ? (
        <div>
          {searching && (
            <div style={{ padding: "8px 8px", fontSize: 11, color: "var(--text-dim)" }}>
              {t("explorer.searching")}
            </div>
          )}
          {!searching && searchResults.map((node) => (
            <SearchResult
              key={node.fullPath}
              node={node}
              cwd={cwd}
              onOpenFile={handleOpenFile}
              onAtMention={onAtMention}
            />
          ))}
          {!searching && searchResults.length === 0 && (
            <div style={{ padding: "8px 8px", fontSize: 11, color: "var(--text-dim)" }}>
              {t("explorer.noMatches")}
            </div>
          )}
        </div>
      ) : (
        <>
      {visibleRecentFiles.length > 0 && (
        <div style={{ padding: "2px 0 6px" }}>
          <div style={{ padding: "3px 6px", fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 700, letterSpacing: 0 }}>
            {t("explorer.recent")}
          </div>
          {visibleRecentFiles.map((file) => (
            <RecentFileRow
              key={file.filePath}
              file={file}
              cwd={cwd}
              onOpenFile={handleOpenFile}
              onAtMention={onAtMention}
            />
          ))}
        </div>
      )}
      {roots.map((node) => (
        <TreeNode
          key={`${trackedOnly ? "tracked" : "all"}:${node.fullPath}`}
          node={node}
          depth={0}
          cwd={cwd}
          onOpenFile={handleOpenFile}
          onAtMention={onAtMention}
          expandedPaths={expandedPaths}
          onToggleExpanded={handleToggleExpanded}
          refreshKey={refreshKey}
          trackedOnly={trackedOnly}
        />
      ))}
      {roots.length === 0 && (
        <div style={{ padding: "8px 12px", fontSize: 11, color: "var(--text-dim)" }}>
          {t("explorer.noFiles")}
        </div>
      )}
        </>
      )}
    </div>
  );
}

function FileRowActions({
  filePath,
  fileName,
  cwd,
  visible,
  onAtMention,
}: {
  filePath: string;
  fileName: string;
  cwd: string;
  visible: boolean;
  onAtMention?: (relativePath: string) => void;
}) {
  const { t } = useLocale();
  const [focused, setFocused] = useState(false);
  const active = visible || focused;
  const buttonBase = {
    display: "grid",
    placeItems: "center",
    width: 22,
    height: 20,
    border: "1px solid var(--border)",
    borderRadius: 4,
    background: "var(--bg-panel)",
    color: "var(--text-muted)",
    cursor: "pointer",
    flexShrink: 0,
  } satisfies CSSProperties;

  return (
    <span
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 3,
        width: onAtMention ? 47 : 22,
        flexShrink: 0,
      }}
    >
      <a
        href={getFileDownloadUrl(filePath)}
        download={fileName}
        onClick={(e) => e.stopPropagation()}
        title={t("explorer.download")}
        style={{
          ...buttonBase,
          color: "var(--accent)",
          opacity: active ? 1 : 0.68,
          textDecoration: "none",
          transition: "opacity 0.12s ease, background 0.12s ease",
        }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v11" />
          <path d="m7 10 5 5 5-5" />
          <path d="M5 21h14" />
        </svg>
      </a>
      {onAtMention && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onAtMention(getRelativeFilePath(filePath, cwd));
          }}
          title={t("explorer.insertPath")}
          style={{
            ...buttonBase,
            opacity: active ? 1 : 0,
            pointerEvents: active ? "auto" : "none",
            transition: "opacity 0.12s ease",
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
          </svg>
        </button>
      )}
    </span>
  );
}

function RecentFileRow({
  file,
  cwd,
  onOpenFile,
  onAtMention,
}: {
  file: RecentFile;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  onAtMention?: (relativePath: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={() => onOpenFile(file.filePath, file.name)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        height: 24,
        padding: "0 6px",
        borderRadius: 4,
        background: hovered ? "var(--bg-hover)" : "transparent",
        cursor: "pointer",
      }}
      title={file.filePath}
    >
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
        {getFileIcon(file.name, 14)}
      </span>
      <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: 12 }}>
        {getRelativeFilePath(file.filePath, cwd)}
      </span>
      <FileRowActions filePath={file.filePath} fileName={file.name} cwd={cwd} visible={hovered} onAtMention={onAtMention} />
    </div>
  );
}

function SearchResult({
  node,
  cwd,
  onOpenFile,
  onAtMention,
}: {
  node: FileNode;
  cwd: string;
  onOpenFile: (filePath: string, fileName: string) => void;
  onAtMention?: (relativePath: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={() => onOpenFile(node.fullPath, node.name)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        minHeight: 28,
        padding: "2px 6px",
        borderRadius: 4,
        background: hovered ? "var(--bg-hover)" : "transparent",
        cursor: "pointer",
      }}
      title={node.fullPath}
    >
      <span style={{ flexShrink: 0, display: "flex", alignItems: "center" }}>
        {getFileIcon(node.name, 14)}
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text)", fontSize: 12 }}>
          {node.name}
        </span>
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-dim)", fontSize: 10 }}>
          {getRelativeFilePath(node.fullPath, cwd)}
        </span>
      </span>
      <FileRowActions filePath={node.fullPath} fileName={node.name} cwd={cwd} visible={hovered} onAtMention={onAtMention} />
    </div>
  );
}
