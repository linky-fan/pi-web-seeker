"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { SessionEntry, SessionTreeNode } from "@/lib/types";
import { useLocale } from "@/lib/i18n";

interface Props {
  sessionId?: string | null;
  tree: SessionTreeNode[];
  activeLeafId: string | null;
  onLeafChange: (leafId: string | null) => void;
  /** When true, renders as a compact inline button for embedding in a top bar */
  inline?: boolean;
  /** When inline, use this ref's bounding rect to size/position the dropdown */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Controlled open state for inline mode */
  open?: boolean;
  /** Called when the button is clicked in inline mode */
  onToggle?: () => void;
  /** Whether a session is currently active (used to show appropriate empty reason) */
  hasSession?: boolean;
  /** Render only the branch panel content; parent owns the trigger/dropdown chrome */
  panelOnly?: boolean;
}

type BranchLabels = Record<string, string>;

const BRANCH_LABEL_STORAGE_PREFIX = "pi-web.branch-labels.";

function isNavigableNode(node: SessionTreeNode): boolean {
  return node.entry.type !== "label" && node.entry.type !== "session_info";
}

function navigableChildren(node: SessionTreeNode): SessionTreeNode[] {
  return node.children.filter(isNavigableNode);
}

function storageKey(sessionId?: string | null): string | null {
  return sessionId ? `${BRANCH_LABEL_STORAGE_PREFIX}${sessionId}` : null;
}

function readBranchLabels(sessionId?: string | null): BranchLabels {
  const key = storageKey(sessionId);
  if (!key || typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const labels: BranchLabels = {};
    for (const [id, label] of Object.entries(parsed)) {
      if (typeof id === "string" && typeof label === "string" && label.trim()) {
        labels[id] = label.trim();
      }
    }
    return labels;
  } catch {
    return {};
  }
}

function writeBranchLabels(sessionId: string | null | undefined, labels: BranchLabels): void {
  const key = storageKey(sessionId);
  if (!key) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(labels));
  } catch {
    // localStorage may be unavailable in restricted contexts
  }
}

// Find the set of entry IDs on the path from root to activeLeafId
function buildActivePath(nodes: SessionTreeNode[], targetId: string | null): Set<string> {
  if (!targetId) return new Set();
  function search(nodes: SessionTreeNode[], path: string[]): string[] | null {
    for (const node of nodes) {
      const next = [...path, node.entry.id];
      if (node.entry.id === targetId) return next;
      const found = search(node.children, next);
      if (found) return found;
    }
    return null;
  }
  return new Set(search(nodes, []) ?? []);
}

function findPath(nodes: SessionTreeNode[], targetId: string | null): SessionTreeNode[] {
  if (!targetId) return [];
  function search(nodes: SessionTreeNode[], path: SessionTreeNode[]): SessionTreeNode[] | null {
    for (const node of nodes) {
      const next = [...path, node];
      if (node.entry.id === targetId) return next;
      const found = search(node.children, next);
      if (found) return found;
    }
    return null;
  }
  return search(nodes, []) ?? [];
}

// Compress a linear chain into the first branching/leaf node.
// Returns the representative node to display, plus a count of skipped nodes.
function compress(node: SessionTreeNode): { node: SessionTreeNode; skipped: number } {
  let current = node;
  let skipped = 0;
  while (navigableChildren(current).length === 1) {
    current = navigableChildren(current)[0];
    skipped++;
  }
  return { node: current, skipped };
}

function getLabel(entry: SessionEntry): string {
  if (entry.type === "message" && "message" in entry) {
    const msg = entry.message as { role: string; content: unknown };
    const content = msg.content;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .filter((b): b is { type: "text"; text: string } => b.type === "text")
        .map((b) => b.text)
        .join(" ");
    }
    if (text.length > 40) text = text.slice(0, 40) + "…";
    if (text) return text;
    if (msg.role === "assistant") return "[assistant]";
  }
  return entry.type;
}

function getNodeLabel(node: SessionTreeNode, branchLabels: BranchLabels): string {
  return branchLabels[node.entry.id] || node.label || getLabel(node.entry);
}

function getRole(entry: SessionEntry): string | null {
  return entry.type === "message" && "message" in entry
    ? (entry.message as { role: string }).role
    : null;
}

function countMessages(nodes: SessionTreeNode[]): number {
  return nodes.filter((node) => node.entry.type === "message").length;
}

function formatTime(entry: SessionEntry): string {
  const date = new Date(entry.timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function summarizeDiff(activePath: SessionTreeNode[], targetPath: SessionTreeNode[]) {
  let common = 0;
  while (
    common < activePath.length &&
    common < targetPath.length &&
    activePath[common].entry.id === targetPath[common].entry.id
  ) {
    common++;
  }
  return {
    common,
    leaving: activePath.slice(common),
    entering: targetPath.slice(common),
  };
}

// Does the tree have any branching at all?
function hasBranch(nodes: SessionTreeNode[]): boolean {
  for (const node of nodes) {
    const children = navigableChildren(node);
    if (children.length > 1) return true;
    if (hasBranch(children)) return true;
  }
  return false;
}

interface TreeNodeProps {
  node: SessionTreeNode;
  activePathIds: Set<string>;
  depth: number;
  isLast: boolean;
  parentLines: boolean[]; // whether ancestor at each depth has more siblings after
  onSelect: (id: string) => void;
  onPreview: (id: string) => void;
  onTagTarget: (id: string) => void;
  branchLabels: BranchLabels;
  previewTargetId: string | null;
}

function TreeNodeView({ node, activePathIds, depth, isLast, parentLines, onSelect, onPreview, onTagTarget, branchLabels, previewTargetId }: TreeNodeProps) {
  const { t } = useLocale();
  const { node: rep, skipped } = compress(node);
  const isActive = activePathIds.has(rep.entry.id);
  const isOnPath = activePathIds.has(node.entry.id) || activePathIds.has(rep.entry.id);
  const isPreviewed = previewTargetId === rep.entry.id;
  const label = getNodeLabel(rep, branchLabels);
  const rawLabel = branchLabels[rep.entry.id] || rep.label;
  const role = getRole(rep.entry);
  const childNodes = navigableChildren(rep);

  return (
    <div>
      {/* This node row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 24,
          cursor: "pointer",
          background: isPreviewed && !isActive ? "var(--bg-hover)" : "transparent",
          borderRadius: 4,
        }}
        onClick={() => onSelect(rep.entry.id)}
        onMouseEnter={() => onPreview(rep.entry.id)}
      >
        {/* Indent guide lines */}
        {parentLines.map((hasLine, i) => (
          <div key={i} style={{ width: 16, flexShrink: 0, position: "relative", height: "100%", alignSelf: "stretch" }}>
            {hasLine && (
              <div style={{
                position: "absolute",
                left: 7,
                top: 0,
                bottom: 0,
                width: 1,
                background: "var(--border)",
              }} />
            )}
          </div>
        ))}

        {/* Branch connector */}
        <div style={{ width: 16, flexShrink: 0, position: "relative", height: "100%", alignSelf: "stretch" }}>
          {/* vertical line up (to parent) */}
          <div style={{
            position: "absolute",
            left: 7,
            top: 0,
            bottom: isLast ? "50%" : 0,
            width: 1,
            background: "var(--border)",
          }} />
          {/* horizontal line to node */}
          <div style={{
            position: "absolute",
            left: 7,
            top: "50%",
            width: 9,
            height: 1,
            background: "var(--border)",
          }} />
        </div>

        {/* Node dot */}
        <div style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          flexShrink: 0,
          background: isActive ? "var(--accent)" : isOnPath ? "var(--text-muted)" : "var(--border)",
          border: isActive ? "none" : "1px solid var(--text-dim)",
          marginRight: 6,
          transition: "background 0.12s",
        }} />

        {/* Role badge */}
        {role && (
          <span style={{
            fontSize: 9,
            fontFamily: "var(--font-mono)",
            color: role === "user" ? "var(--accent)" : "var(--text-dim)",
            background: role === "user" ? "rgba(37,99,235,0.08)" : "var(--bg-hover)",
            border: `1px solid ${role === "user" ? "rgba(37,99,235,0.2)" : "var(--border)"}`,
            borderRadius: 3,
            padding: "0 4px",
            marginRight: 5,
            flexShrink: 0,
            lineHeight: "16px",
          }}>
            {role === "user" ? "U" : "A"}
          </span>
        )}

        {/* Skipped indicator */}
        {skipped > 0 && (
          <span style={{ fontSize: 10, color: "var(--text-dim)", marginRight: 5, flexShrink: 0 }}>
            +{skipped}
          </span>
        )}

        {/* Label */}
        <span style={{
          fontSize: 11,
          color: isActive ? "var(--text)" : isOnPath ? "var(--text-muted)" : "var(--text-dim)",
          fontWeight: isActive ? 500 : 400,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          flex: 1,
          minWidth: 0,
        }}>
          {label}
        </span>
        {rawLabel && (
          <span style={{
            maxWidth: 90,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginLeft: 6,
            padding: "0 5px",
            lineHeight: "15px",
            borderRadius: 4,
            border: "1px solid rgba(96,165,250,0.35)",
            color: "var(--accent)",
            background: "rgba(96,165,250,0.10)",
            fontSize: 9,
            flexShrink: 0,
          }}>
            {rawLabel}
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPreview(rep.entry.id);
            onTagTarget(rep.entry.id);
          }}
          title={t("branches.labelBranch")}
          style={{
            width: 20,
            height: 20,
            marginLeft: 4,
            border: "none",
            background: "none",
            color: isPreviewed ? "var(--accent)" : "var(--text-dim)",
            cursor: "pointer",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
          }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7" />
            <path d="M16 3h5v5" />
            <path d="M10 14 21 3" />
          </svg>
        </button>
      </div>

      {/* Children */}
      {childNodes.map((child, idx) => (
        <TreeNodeView
          key={child.entry.id}
          node={child}
          activePathIds={activePathIds}
          depth={depth + 1}
          isLast={idx === childNodes.length - 1}
          parentLines={[...parentLines, !isLast]}
          onSelect={onSelect}
          onPreview={onPreview}
          onTagTarget={onTagTarget}
          branchLabels={branchLabels}
          previewTargetId={previewTargetId}
        />
      ))}
    </div>
  );
}

function PathPill({ node, branchLabels, active }: { node: SessionTreeNode; branchLabels: BranchLabels; active?: boolean }) {
  const role = getRole(node.entry);
  return (
    <span
      title={getLabel(node.entry)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        maxWidth: 150,
        padding: "2px 6px",
        borderRadius: 5,
        border: `1px solid ${active ? "rgba(96,165,250,0.45)" : "var(--border)"}`,
        color: active ? "var(--accent)" : "var(--text-muted)",
        background: active ? "rgba(96,165,250,0.10)" : "var(--bg)",
        fontSize: 10,
        whiteSpace: "nowrap",
      }}
    >
      {role && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9, color: role === "user" ? "var(--accent)" : "var(--text-dim)" }}>
          {role === "user" ? "U" : "A"}
        </span>
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
        {getNodeLabel(node, branchLabels)}
      </span>
    </span>
  );
}

function DiffPreview({
  targetPath,
  activePath,
  branchLabels,
  labelValue,
  onLabelChange,
  labelInputRef,
}: {
  targetPath: SessionTreeNode[];
  activePath: SessionTreeNode[];
  branchLabels: BranchLabels;
  labelValue: string;
  onLabelChange: (label: string) => void;
  labelInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { t } = useLocale();
  const target = targetPath[targetPath.length - 1] ?? null;
  const diff = summarizeDiff(activePath, targetPath);
  const isCurrent = target && activePath[activePath.length - 1]?.entry.id === target.entry.id;
  const showList = (title: string, nodes: SessionTreeNode[], color: string) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 10, color, fontWeight: 700, marginBottom: 4 }}>{title}</div>
      {nodes.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{t("branches.none")}</div>
      ) : (
        nodes.slice(0, 4).map((node) => (
          <div key={node.entry.id} style={{ display: "flex", alignItems: "center", gap: 5, height: 20, minWidth: 0 }}>
            <span style={{ fontSize: 9, color: "var(--text-dim)", width: 32, flexShrink: 0 }}>{formatTime(node.entry)}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {getNodeLabel(node, branchLabels)}
            </span>
          </div>
        ))
      )}
      {nodes.length > 4 && (
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{t("branches.more", { count: nodes.length - 4 })}</div>
      )}
    </div>
  );

  if (!target) {
    return (
      <div style={{ padding: 12, color: "var(--text-dim)", fontSize: 12 }}>
        {t("branches.previewHint")}
      </div>
    );
  }

  return (
    <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
      <div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 700, marginBottom: 4, letterSpacing: 0 }}>
          {t("branches.preview")}
        </div>
        <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {getNodeLabel(target, branchLabels)}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          {isCurrent ? t("branches.current") : t("branches.diff", { out: countMessages(diff.leaving), in: countMessages(diff.entering) })}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          ref={labelInputRef}
          value={labelValue}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder={t("branches.addLabel")}
          style={{
            flex: 1,
            minWidth: 0,
            height: 26,
            padding: "0 8px",
            borderRadius: 5,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: 12,
            outline: "none",
          }}
        />
        {labelValue && (
          <button
            onClick={() => onLabelChange("")}
            title={t("branches.clearLabel")}
            style={{
              width: 26,
              height: 26,
              borderRadius: 5,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--text-dim)",
              cursor: "pointer",
            }}
          >
            x
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, minWidth: 0 }}>
        {showList(t("branches.leaving"), diff.leaving, "#f97316")}
        {showList(t("branches.entering"), diff.entering, "var(--accent)")}
      </div>
    </div>
  );
}

function BranchPanel({
  firstNode,
  noBranchReason,
  activePath,
  activePathIds,
  previewTargetId,
  setPreviewTargetId,
  onSelect,
  onTagTarget,
  branchLabels,
  labelInputRef,
  onLabelChange,
}: {
  firstNode: SessionTreeNode | null;
  noBranchReason: string | null;
  activePath: SessionTreeNode[];
  activePathIds: Set<string>;
  previewTargetId: string | null;
  setPreviewTargetId: (id: string) => void;
  onSelect: (id: string) => void;
  onTagTarget: (id: string) => void;
  branchLabels: BranchLabels;
  labelInputRef: React.RefObject<HTMLInputElement | null>;
  onLabelChange: (id: string, label: string) => void;
}) {
  const { t } = useLocale();
  const childNodes = firstNode ? navigableChildren(firstNode) : [];
  const previewPath = findPath(firstNode ? [firstNode] : [], previewTargetId);
  const previewNode = previewPath[previewPath.length - 1] ?? null;
  const labelValue = previewNode ? branchLabels[previewNode.entry.id] || previewNode.label || "" : "";
  const visibleActivePath = activePath.filter(isNavigableNode);

  return (
    <div>
      {visibleActivePath.length > 0 && (
        <div style={{ padding: "10px 12px 8px", borderBottom: "1px solid var(--border)", background: "var(--bg)" }}>
          <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", fontWeight: 700, marginBottom: 6, letterSpacing: 0 }}>
            {t("branches.currentPath")}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
            {visibleActivePath.slice(-6).map((node, index, arr) => (
              <PathPill key={node.entry.id} node={node} branchLabels={branchLabels} active={index === arr.length - 1} />
            ))}
          </div>
        </div>
      )}
      {firstNode && childNodes.length > 0 ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(240px, 0.9fr)", minHeight: 210, maxHeight: 330 }}>
          <div style={{ padding: "6px 8px 8px 12px", overflowY: "auto", borderRight: "1px solid var(--border)" }}>
            {childNodes.map((child, idx) => (
              <TreeNodeView
                key={child.entry.id}
                node={child}
                activePathIds={activePathIds}
                depth={0}
                isLast={idx === childNodes.length - 1}
                parentLines={[]}
                onSelect={onSelect}
                onPreview={setPreviewTargetId}
                onTagTarget={onTagTarget}
                branchLabels={branchLabels}
                previewTargetId={previewTargetId}
              />
            ))}
          </div>
          <div style={{ overflow: "hidden" }}>
            <DiffPreview
              targetPath={previewPath}
              activePath={activePath}
              branchLabels={branchLabels}
              labelValue={labelValue}
              onLabelChange={(label) => previewNode && onLabelChange(previewNode.entry.id, label)}
              labelInputRef={labelInputRef}
            />
          </div>
        </div>
      ) : (
        <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
          {noBranchReason ?? t("branches.noBranches")}
        </div>
      )}
    </div>
  );
}

export function BranchNavigator({ sessionId, tree, activeLeafId, onLeafChange, inline, containerRef, open: openProp, onToggle, hasSession, panelOnly }: Props) {
  const { t } = useLocale();
  const [openInternal, setOpenInternal] = useState(false);
  const open = panelOnly ? true : openProp !== undefined ? openProp : openInternal;
  const btnRef = useRef<HTMLButtonElement>(null);
  const labelInputRef = useRef<HTMLInputElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [previewTargetId, setPreviewTargetId] = useState<string | null>(activeLeafId);
  const [branchLabels, setBranchLabels] = useState<BranchLabels>({});

  useEffect(() => {
    setBranchLabels(readBranchLabels(sessionId));
  }, [sessionId]);

  useEffect(() => {
    if (!open || !inline) return;
    const anchor = containerRef?.current ?? btnRef.current;
    if (!anchor) return;
    const update = () => {
      const rect = anchor.getBoundingClientRect();
      setDropdownPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(anchor);
    return () => ro.disconnect();
  }, [open, inline, containerRef]);

  const activePathIds = useMemo(
    () => buildActivePath(tree, activeLeafId),
    [tree, activeLeafId]
  );
  const activePath = useMemo(
    () => findPath(tree, activeLeafId),
    [tree, activeLeafId]
  );

  useEffect(() => {
    if (open) setPreviewTargetId(activeLeafId);
  }, [activeLeafId, open]);

  const handleSelect = useCallback((id: string) => {
    onLeafChange(id);
  }, [onLeafChange]);

  const handleTagTarget = useCallback((id: string) => {
    setPreviewTargetId(id);
    requestAnimationFrame(() => labelInputRef.current?.focus());
  }, []);

  const handleLabelChange = useCallback((id: string, label: string) => {
    const trimmed = label.trim();
    setBranchLabels((prev) => {
      const next = { ...prev };
      if (trimmed) next[id] = trimmed;
      else delete next[id];
      writeBranchLabels(sessionId, next);
      return next;
    });
  }, [sessionId]);

  const noBranchReason = !hasSession
    ? t("branches.noSession")
    : !hasBranch(tree)
      ? t("branches.noBranches")
      : null;

  // Find first meaningful node (skip pure linear prefix)
  const compressed = tree.length > 0 ? compress(tree[0]) : null;
  const firstNode = compressed?.node ?? null;
  const hasContent = !noBranchReason && firstNode && firstNode.children.length > 1;

  const panel = (
    <BranchPanel
      firstNode={hasContent ? firstNode : null}
      noBranchReason={noBranchReason}
      activePath={activePath}
      activePathIds={activePathIds}
      previewTargetId={previewTargetId}
      setPreviewTargetId={setPreviewTargetId}
      onSelect={handleSelect}
      onTagTarget={handleTagTarget}
      branchLabels={branchLabels}
      labelInputRef={labelInputRef}
      onLabelChange={handleLabelChange}
    />
  );

  const branchIcon = (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: hasContent ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }}>
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );

  const chevron = (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 2, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
      <polyline points="2 3.5 5 6.5 8 3.5" />
    </svg>
  );

  if (panelOnly) {
    return panel;
  }

  if (inline) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "stretch" }}>
        <button
          ref={btnRef}
          onClick={() => onToggle ? onToggle() : setOpenInternal((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            height: "100%",
            padding: "0 12px",
            background: open ? "var(--bg-selected)" : "none",
            border: "none",
            borderTop: open ? "2px solid var(--accent)" : "2px solid transparent",
            borderRight: "1px solid var(--border)",
            cursor: "pointer",
            color: open ? "var(--text)" : "var(--text-muted)",
            fontSize: 11,
            whiteSpace: "nowrap",
            transition: "color 0.1s, background 0.1s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = open ? "var(--text)" : "var(--text-muted)"; }}
        >
          {branchIcon}
          <span>{t("branches.label")}</span>
        </button>
        {open && dropdownPos && (
          <div style={{
            position: "fixed",
            top: dropdownPos.top,
            left: dropdownPos.left,
            width: dropdownPos.width,
            background: "var(--bg-panel)",
            borderBottom: "1px solid var(--border)",
            zIndex: 500,
          }}>
            {panel}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ borderBottom: "1px solid var(--border)", background: "var(--bg)", flexShrink: 0, position: "relative" }}>
      {/* Header toggle */}
      <button
        onClick={() => setOpenInternal((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          width: "100%",
          padding: "5px 12px",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--text-muted)",
          fontSize: 11,
          textAlign: "left",
        }}
      >
        {branchIcon}
        <span style={{ color: "var(--text-muted)" }}>{t("branches.label")}</span>
        {chevron}
      </button>

      {/* Tree panel - overlay */}
      {open && (
        <div style={{
          position: "absolute",
          top: "100%",
          left: 0,
          right: 0,
          background: "var(--bg)",
          borderBottom: "1px solid var(--border)",
          boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          zIndex: 100,
        }}>
          {panel}
        </div>
      )}
    </div>
  );
}
