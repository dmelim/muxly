import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ReactNode } from "react";

type TooltipProps = {
  label: string;
  /** Which side of the trigger the tooltip appears on. Defaults to bottom. */
  side?: "top" | "bottom";
  /** Applied to the wrapper — use for layout (e.g. `flex-1`). */
  className?: string;
  children: ReactNode;
};

/** Delay before the bubble appears, for a native tooltip feel. */
const SHOW_DELAY_MS = 300;
/** Gap between the trigger and the bubble. */
const GAP = 6;
/** Minimum distance the bubble keeps from the viewport edge. */
const EDGE = 8;

/**
 * Hover tooltip. The bubble is rendered through a portal to `document.body`
 * and positioned with `position: fixed`, so it is never clipped by an
 * ancestor's `overflow: hidden` (sidebars, terminal panes) and never spills
 * off-screen — its horizontal position is clamped to the viewport.
 */
export function Tooltip({ label, side = "bottom", className = "", children }: TooltipProps) {
  const triggerRef = useRef<HTMLSpanElement | null>(null);
  const bubbleRef = useRef<HTMLSpanElement | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const place = useCallback(() => {
    const trigger = triggerRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;
    const t = trigger.getBoundingClientRect();
    const b = bubble.getBoundingClientRect();
    const centered = t.left + t.width / 2 - b.width / 2;
    const left = Math.max(EDGE, Math.min(centered, window.innerWidth - b.width - EDGE));
    const top = side === "top" ? t.top - b.height - GAP : t.bottom + GAP;
    setPos({ top, left });
  }, [side]);

  // Measure and position the bubble once it has mounted, before the browser
  // paints — so it never flashes at the top-left corner.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place, label]);

  const show = useCallback(() => {
    timerRef.current = window.setTimeout(() => setOpen(true), SHOW_DELAY_MS);
  }, []);
  const hide = useCallback(() => {
    window.clearTimeout(timerRef.current);
    setOpen(false);
  }, []);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  return (
    <span
      ref={triggerRef}
      className={`inline-flex ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
    >
      {children}
      {open
        ? createPortal(
            <span
              ref={bubbleRef}
              role="tooltip"
              style={{ top: pos.top, left: pos.left }}
              className={
                "pointer-events-none fixed z-50 whitespace-nowrap rounded-md " +
                "border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 shadow-lg"
              }
            >
              {label}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
