type Rect = { left: number; right: number; top: number; bottom: number };
export type TabStripGeometry = { panelId: string; bounds: Rect; tabs: Rect[] };
export type TabDropTarget = { panelId: string; index: number; x: number; top: number; height: number };

// Use whole tabs (including close buttons and padding), in original-list order.
// The workspace move operation adjusts the index when removing the source tab.
export function tabDropTarget(strips: TabStripGeometry[], x: number, y: number): TabDropTarget | null {
  for (const { panelId, bounds, tabs } of strips) {
    if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) continue;
    const found = tabs.findIndex((tab) => x < (tab.left + tab.right) / 2);
    const index = found < 0 ? tabs.length : found;
    const edge = tabs[index]?.left ?? tabs.at(-1)?.right ?? bounds.left;
    return { panelId, index, x: Math.max(bounds.left + 1, Math.min(bounds.right - 1, edge)), top: bounds.top, height: bounds.bottom - bounds.top };
  }
  return null;
}

export function tabEdgeScroll(bounds: Rect, x: number, y: number) {
  if (y < bounds.top || y > bounds.bottom || x < bounds.left || x > bounds.right) return 0;
  const edge = Math.min(28, (bounds.right - bounds.left) / 4);
  if (x < bounds.left + edge) return -8 * (1 - (x - bounds.left) / edge);
  if (x > bounds.right - edge) return 8 * (1 - (bounds.right - x) / edge);
  return 0;
}

// Pointer events avoid relying on native HTML drag initiation on WKWebView
// buttons. Sidebar service dragging remains on its independent native path.
export function attachTabDragging(
  workspace: HTMLElement,
  onChange: (drag: { serviceId: string; target: TabDropTarget | null } | null) => void,
  onMove: (serviceId: string, panelId: string, index: number) => void
) {
  let session: { serviceId: string; pointerId: number; handle: HTMLElement; startX: number; startY: number; x: number; y: number; active: boolean } | null = null;
  let frame = 0;
  let suppressClick = false;
  const strips = () => Array.from(workspace.querySelectorAll<HTMLElement>("[data-tab-strip]"));
  const targetAt = (x: number, y: number) => tabDropTarget(strips().map((strip) => ({
    panelId: strip.dataset.tabStrip!, bounds: strip.getBoundingClientRect(),
    tabs: Array.from(strip.querySelectorAll<HTMLElement>("[data-terminal-tab]")).map((tab) => tab.getBoundingClientRect())
  })), x, y);
  const clear = () => {
    const previous = session;
    session = null;
    cancelAnimationFrame(frame);
    frame = 0;
    if (previous?.handle.hasPointerCapture(previous.pointerId)) previous.handle.releasePointerCapture(previous.pointerId);
    onChange(null);
  };
  const tick = () => {
    if (!session?.active) return;
    for (const strip of strips()) strip.scrollLeft += tabEdgeScroll(strip.getBoundingClientRect(), session.x, session.y);
    onChange({ serviceId: session.serviceId, target: targetAt(session.x, session.y) });
    frame = requestAnimationFrame(tick);
  };
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || !event.isPrimary || event.ctrlKey) return;
    const handle = (event.target as Element).closest<HTMLElement>("[data-tab-drag-handle]");
    if (!handle || !workspace.contains(handle)) return;
    clear();
    suppressClick = false;
    session = { serviceId: handle.dataset.tabDragHandle!, pointerId: event.pointerId, handle,
      startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false };
    handle.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent) => {
    if (!session || session.pointerId !== event.pointerId) return;
    session.x = event.clientX;
    session.y = event.clientY;
    if (!session.active && Math.hypot(session.x - session.startX, session.y - session.startY) < 5) return;
    event.preventDefault();
    if (!session.active) { session.active = true; suppressClick = true; tick(); }
  };
  const up = (event: PointerEvent) => {
    if (!session || session.pointerId !== event.pointerId) return;
    const serviceId = session.serviceId;
    const target = session.active ? targetAt(event.clientX, event.clientY) : null;
    // Release capture before moving: moving the last tab removes its panel.
    clear();
    if (target) onMove(serviceId, target.panelId, target.index);
  };
  const cancel = (event: PointerEvent) => { if (session?.pointerId === event.pointerId) clear(); };
  const blur = () => clear();
  const key = (event: KeyboardEvent) => { if (event.key === "Escape" && session) { event.preventDefault(); clear(); } };
  const click = (event: MouseEvent) => {
    if (!suppressClick || event.detail === 0) return;
    suppressClick = false;
    event.preventDefault();
    event.stopPropagation();
  };
  const resetClick = () => { suppressClick = false; };
  window.addEventListener("pointerdown", resetClick, true);
  workspace.addEventListener("pointerdown", down);
  window.addEventListener("lostpointercapture", cancel);
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", blur);
  window.addEventListener("keydown", key);
  window.addEventListener("click", click, true);
  return () => {
    clear();
    workspace.removeEventListener("pointerdown", down);
    window.removeEventListener("lostpointercapture", cancel);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", blur);
    window.removeEventListener("keydown", key);
    window.removeEventListener("click", click, true);
    window.removeEventListener("pointerdown", resetClick, true);
  };
}
