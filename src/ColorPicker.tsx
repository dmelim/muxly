import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HexColorPicker } from "react-colorful";
import { Button } from "./Button";
import { CloseIcon } from "./icons";

const POPOVER_WIDTH = 224;
const POPOVER_EDGE_GAP = 8;
const POPOVER_TRIGGER_GAP = 6;
const FALLBACK_POPOVER_HEIGHT = 244;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function ColorPicker({
  color,
  label,
  onChange
}: {
  color: string;
  label: string;
  onChange: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const resolvedColor = HEX_COLOR.test(color) ? color : "#000000";

  const placePopover = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const popoverHeight = popoverRef.current?.offsetHeight ?? FALLBACK_POPOVER_HEIGHT;
    const left = Math.max(
      POPOVER_EDGE_GAP,
      Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - POPOVER_EDGE_GAP)
    );
    const below = rect.bottom + POPOVER_TRIGGER_GAP;
    const top =
      below + popoverHeight <= window.innerHeight - POPOVER_EDGE_GAP
        ? below
        : Math.max(POPOVER_EDGE_GAP, rect.top - POPOVER_TRIGGER_GAP - popoverHeight);

    setPopoverPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    placePopover();
    const frame = window.requestAnimationFrame(placePopover);
    return () => window.cancelAnimationFrame(frame);
  }, [open, placePopover]);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (target && (triggerRef.current?.contains(target) || popoverRef.current?.contains(target))) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", placePopover);
    window.addEventListener("scroll", placePopover, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", placePopover);
      window.removeEventListener("scroll", placePopover, true);
    };
  }, [open, placePopover]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={`Choose ${label} colour`}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="size-5 shrink-0 rounded border border-white/20 transition hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
        style={{ background: resolvedColor }}
      />
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              aria-label={`${label} colour picker`}
              style={{ top: popoverPos.top, left: popoverPos.left, width: POPOVER_WIDTH }}
              className="muxly-color-picker fixed z-50 rounded-md border border-white/10 bg-[#18181b] p-3 shadow-lg"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-zinc-200">{label}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  aria-label={`Close ${label} colour picker`}
                >
                  <CloseIcon className="size-3.5" />
                </Button>
              </div>
              <HexColorPicker color={resolvedColor} onChange={onChange} />
              <div className="mt-3 flex items-center gap-2 text-[11px] text-zinc-400">
                <span
                  aria-hidden="true"
                  className="size-4 rounded border border-white/20"
                  style={{ background: resolvedColor }}
                />
                <span className="font-mono uppercase">{resolvedColor}</span>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
