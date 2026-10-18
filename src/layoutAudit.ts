// Generic layout audit for floating UI: overlays that spill out of their
// container, and controls that something else is sitting on top of. It is
// exposed as `muxlyLayoutAudit()` in dev builds and reused by the browser
// interaction test, so the same rules run by hand and in CI-style sweeps.

export type LayoutIssue = {
  kind: "clipped" | "covered";
  element: Element;
  by: Element | null;
  detail: string;
};

const CONTROL_SELECTOR =
  'button, input, textarea, select, a[href], [role="button"], [role="menuitem"], [role="tab"]';
// Transient layers that are meant to sit above everything else.
const INTENTIONAL_LAYER_SELECTOR = '[aria-modal="true"], [role="menu"], [role="tooltip"]';
// xterm positions its own internals absolutely; they are not app overlays.
const IGNORED_SELECTOR = ".xterm, [data-layout-audit-ignore]";

function describe(element: Element | null) {
  if (!element) return "nothing";
  const label =
    element.getAttribute("aria-label") ||
    element.getAttribute("placeholder") ||
    element.textContent?.trim().slice(0, 30);
  const classes = typeof element.className === "string" ? element.className.split(/\s+/).slice(0, 3).join(".") : "";
  return `<${element.tagName.toLowerCase()}${classes ? `.${classes}` : ""}>${label ? ` "${label}"` : ""}`;
}

function isShown(element: Element) {
  if (element.closest("[inert], [aria-hidden='true']")) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  if ("checkVisibility" in element) {
    return element.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  }
  const style = getComputedStyle(element);
  return style.visibility !== "hidden" && style.opacity !== "0";
}

// Nearest ancestor that hides overflow without scrolling. Scroll containers
// are skipped: content scrolled out of view is expected, not a defect.
function clippingAncestor(element: Element) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if ([overflowX, overflowY].some((value) => value === "hidden" || value === "clip")) return node;
    if ([overflowX, overflowY].some((value) => value === "auto" || value === "scroll")) return null;
  }
  return null;
}

function inside(inner: DOMRect, outer: DOMRect, tolerance = 0.5) {
  return (
    inner.left >= outer.left - tolerance &&
    inner.top >= outer.top - tolerance &&
    inner.right <= outer.right + tolerance &&
    inner.bottom <= outer.bottom + tolerance
  );
}

// Intersection of every ancestor that hides or scrolls its overflow.
function visibleArea(element: Element) {
  let { left, top, right, bottom } = viewportRect();
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (overflowX === "visible" && overflowY === "visible") continue;
    const rect = node.getBoundingClientRect();
    left = Math.max(left, rect.left);
    top = Math.max(top, rect.top);
    right = Math.min(right, rect.right);
    bottom = Math.min(bottom, rect.bottom);
  }
  return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
}

function viewportRect() {
  return new DOMRect(0, 0, document.documentElement.clientWidth, document.documentElement.clientHeight);
}

export function auditLayout(root: Element = document.body): LayoutIssue[] {
  const issues: LayoutIssue[] = [];

  // Floating elements must stay inside whatever clips them; otherwise part of
  // the overlay (often its buttons) silently disappears at narrow widths.
  for (const element of root.querySelectorAll("*")) {
    if (element.closest(IGNORED_SELECTOR)) continue;
    const { position } = getComputedStyle(element);
    if (position !== "absolute" && position !== "fixed") continue;
    if (!isShown(element)) continue;
    const container = position === "fixed" ? null : clippingAncestor(element);
    const bounds = container ? container.getBoundingClientRect() : viewportRect();
    if (!inside(element.getBoundingClientRect(), bounds)) {
      issues.push({
        kind: "clipped",
        element,
        by: container,
        detail: `${describe(element)} extends outside ${container ? describe(container) : "the viewport"}`
      });
    }
  }

  // Every visible control must be the topmost thing at its own centre;
  // otherwise another panel or overlay is covering it. An open modal's
  // backdrop covers everything outside it on purpose.
  const modal = Array.from(document.querySelectorAll('[aria-modal="true"]')).find(isShown);
  for (const control of root.querySelectorAll(CONTROL_SELECTOR)) {
    if (control.closest(IGNORED_SELECTOR) || !isShown(control)) continue;
    if (modal && !modal.contains(control)) continue;
    if ((control as HTMLButtonElement).disabled) continue;
    const rect = control.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const centre = new DOMRect(x, y, 0, 0);
    if (!inside(centre, viewportRect())) continue;
    // Scrolled out of its list: hidden by design, not covered.
    if (!inside(centre, visibleArea(control))) continue;
    const top = document.elementFromPoint(x, y);
    if (!top || control === top || control.contains(top)) continue;
    if (top.closest(INTENTIONAL_LAYER_SELECTOR)) continue;
    // Pointer-transparent wrappers never steal clicks.
    if (getComputedStyle(top).pointerEvents === "none") continue;
    issues.push({
      kind: "covered",
      element: control,
      by: top,
      detail: `${describe(control)} is covered by ${describe(top)}`
    });
  }

  return issues;
}

// Console entry point: prints a table and returns the issues for inspection.
export function reportLayout(root?: Element) {
  const issues = auditLayout(root);
  if (issues.length === 0) {
    console.info("[layout-audit] no clipped overlays or covered controls");
  } else {
    console.warn(`[layout-audit] ${issues.length} issue(s)`);
    console.table(issues.map(({ kind, detail }) => ({ kind, detail })));
  }
  return issues;
}

// Re-run the audit while panels are dragged, panes resized, or overlays open,
// logging only issues that were not already reported. Returns a stop function.
export function watchLayout(root: Element = document.body) {
  const seen = new Set<string>();
  let timer = 0;
  const run = () => {
    for (const issue of auditLayout(root)) {
      if (seen.has(issue.detail)) continue;
      seen.add(issue.detail);
      console.warn(`[layout-audit] ${issue.kind}: ${issue.detail}`, issue.element, issue.by);
    }
  };
  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 200);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(root, { attributes: true, attributeFilter: ["style", "class", "data-closing"], childList: true, subtree: true });
  window.addEventListener("resize", schedule);
  run();
  console.info("[layout-audit] watching; call the returned function to stop");
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", schedule);
    window.clearTimeout(timer);
  };
}
