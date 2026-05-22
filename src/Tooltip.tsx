import type { ReactNode } from "react";

type TooltipProps = {
  label: string;
  /** Which side of the trigger the tooltip appears on. Defaults to bottom. */
  side?: "top" | "bottom";
  /** Applied to the wrapper — use for layout (e.g. `flex-1`). */
  className?: string;
  children: ReactNode;
};

/**
 * Lightweight CSS-only tooltip. Wraps a trigger; the bubble fades in on hover
 * after a short delay. No dependency, no positioning library — the trigger
 * stays inline-flex and the bubble is centered above/below it.
 */
export function Tooltip({ label, side = "bottom", className = "", children }: TooltipProps) {
  return (
    <span className={`group/tt relative inline-flex ${className}`}>
      {children}
      <span
        role="tooltip"
        className={
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap " +
          "rounded-md border border-white/10 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 " +
          "opacity-0 shadow-lg transition-opacity delay-300 duration-100 " +
          "group-hover/tt:opacity-100 " +
          (side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5")
        }
      >
        {label}
      </span>
    </span>
  );
}
