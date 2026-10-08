import type { Terminal } from "@xterm/xterm";

/** Blank padding above the live screen is not additional output. */
export function hasMeaningfulScrollback(terminal: Pick<Terminal, "buffer">): boolean {
  const buffer = terminal.buffer.active;
  if (buffer.type !== "normal" || buffer.baseY === 0) return false;
  for (let row = 0; row < buffer.baseY; row += 1) {
    const line = buffer.getLine(row);
    if (!line) continue;
    if (line.translateToString(true).trim()) return true;
    // A whitespace-only line may still contain a visible coloured region.
    for (let column = 0; column < line.length; column += 1) {
      const cell = line.getCell(column);
      if (cell && (!cell.isBgDefault() || cell.isInverse() || cell.isUnderline() || cell.isStrikethrough())) {
        return true;
      }
    }
  }
  return false;
}

/** Only alter scroll affordances; never trim or rewrite the terminal buffer. */
export function attachMeaningfulTerminalScroll(terminal: Terminal) {
  let meaningful = false;
  const update = () => {
    meaningful = hasMeaningfulScrollback(terminal);
    terminal.element?.classList.toggle("muxly-empty-scrollback", !meaningful);
  };
  const element = terminal.element;
  const handleWheel = (event: WheelEvent) => {
    // Full-screen applications and mouse-aware programs own their wheel input.
    if (terminal.buffer.active.type !== "normal" || terminal.modes.mouseTrackingMode !== "none" ||
        event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || !event.deltaY) return;
    if (meaningful) return;
    event.preventDefault();
    event.stopPropagation();
  };
  // xterm's descendant ScrollableElement processes wheel input before its
  // outer custom callback. Capture here before it changes the scroll position.
  element?.addEventListener("wheel", handleWheel, { capture: true, passive: false });
  const subscriptions = [terminal.onWriteParsed(update), terminal.onResize(update), terminal.buffer.onBufferChange(update)];
  update();
  return () => {
    for (const subscription of subscriptions) subscription.dispose();
    element?.removeEventListener("wheel", handleWheel, true);
    terminal.element?.classList.remove("muxly-empty-scrollback");
  };
}
