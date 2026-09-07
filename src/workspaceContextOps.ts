import type { WorkspacePanel } from "./types";

export function replaceActiveTab(panels: WorkspacePanel[], panelId: string, serviceId: string) {
  if (panels.some((panel) => panel.tabIds.includes(serviceId))) return panels;
  return panels.map((panel) => {
    if (panel.id !== panelId || !panel.tabIds.includes(panel.activeTabId)) return panel;
    const tabIds = [...panel.tabIds];
    tabIds.splice(tabIds.indexOf(panel.activeTabId), 1, serviceId);
    return { ...panel, tabIds, activeTabId: serviceId };
  });
}

export function moveTabToNewPanel(panels: WorkspacePanel[], sourcePanelId: string, serviceId: string, newPanelId: string) {
  const source = panels.find((panel) => panel.id === sourcePanelId);
  if (!source?.tabIds.includes(serviceId) || panels.some((panel) => panel.id === newPanelId)) return panels;
  const remaining = source.tabIds.filter((id) => id !== serviceId);
  return [...panels.flatMap((panel) => panel.id !== sourcePanelId ? [panel] : remaining.length ? [{ ...panel, tabIds: remaining, activeTabId: panel.activeTabId === serviceId ? remaining[0] : panel.activeTabId }] : []), { id: newPanelId, tabIds: [serviceId], activeTabId: serviceId }];
}

export function closeOtherTabs(panels: WorkspacePanel[], panelId: string, serviceId: string) {
  const target = panels.find((panel) => panel.id === panelId);
  if (!target?.tabIds.includes(serviceId)) return panels;
  return panels.map((panel) => panel.id === panelId ? { ...panel, tabIds: [serviceId], activeTabId: serviceId } : panel);
}
