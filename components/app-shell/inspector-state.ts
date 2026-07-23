import type { Tab } from "../TabBar";

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
