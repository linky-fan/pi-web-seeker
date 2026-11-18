import type { Tab } from "../TabBar";

export function isInspectorMaximized(maximized: boolean, activeTab: Tab | null): boolean {
  return maximized && activeTab !== null;
}

export function openFileTab(tabs: Tab[], filePath: string, label: string, lineNumber?: number): Tab[] {
  const id = `file:${filePath}`;
  const existing = tabs.some((tab) => tab.id === id);
  return existing
    ? tabs.map((tab) => tab.id === id && tab.kind === "file"
      ? { ...tab, label, filePath, lineNumber }
      : tab)
    : [...tabs, { id, label, kind: "file", filePath, lineNumber }];
}

export function appendUniqueTab(tabs: Tab[], tab: Tab): Tab[] {
  return tabs.some((current) => current.id === tab.id) ? tabs : [...tabs, tab];
}

export function closeInspectorTab(tabs: Tab[], activeTabId: string | null, tabId: string): {
  tabs: Tab[];
  activeTabId: string | null;
  panelOpen: boolean;
} {
  const remaining = tabs.filter((tab) => tab.id !== tabId);
  return {
    tabs: remaining,
    activeTabId: activeTabId === tabId
      ? remaining.length > 0 ? remaining[remaining.length - 1].id : null
      : activeTabId,
    panelOpen: remaining.length > 0,
  };
}
