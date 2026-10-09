import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";

/** A run of original characters that Stream mode hides, with the text shown in its place. */
export type RedactionRange = { start: number; end: number; label: string };

type Replacer = string | ((substring: string, ...args: unknown[]) => string);

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Expand `$1`, `$&` and `$$` the way String.prototype.replace does for the
// replacement strings the redaction pipeline uses.
function expandReplacement(template: string, match: RegExpExecArray): string {
  return template.replace(/\$(\$|&|\d{1,2})/g, (token, key: string) => {
    if (key === "$") return "$";
    if (key === "&") return match[0];
    const group = match[Number(key)];
    return Number(key) < match.length ? group ?? "" : token;
  });
}

/**
 * A string that remembers which original character each of its characters
 * came from (-1 for inserted text). The Stream mode redactors only call
 * `replace` on their input, so passing one of these through them yields an
 * exact map of what they hid. Any other string method returns a plain string,
 * which `findRedactions` treats as "tracking lost" and handles conservatively.
 */
class TrackedText extends String {
  constructor(text: string, readonly origins: number[]) {
    super(text);
  }

  override replace(pattern: unknown, replacement: unknown): string {
    return this.track(pattern, replacement as Replacer, false) as unknown as string;
  }

  override replaceAll(pattern: unknown, replacement: unknown): string {
    return this.track(pattern, replacement as Replacer, true) as unknown as string;
  }

  private track(pattern: unknown, replacement: Replacer, all: boolean): TrackedText {
    const source = this.toString();
    const regex = pattern instanceof RegExp
      ? new RegExp(pattern.source, all && !pattern.flags.includes("g") ? `${pattern.flags}g` : pattern.flags)
      : new RegExp(escapeRegExp(String(pattern)), all ? "g" : "");
    let text = "";
    const origins: number[] = [];
    let last = 0;
    regex.lastIndex = 0;
    for (let match = regex.exec(source); match; match = regex.global ? regex.exec(source) : null) {
      const index = match.index;
      const matched = match[0];
      const args: unknown[] = [...match.slice(1), index, source];
      if (match.groups) args.push(match.groups);
      const replaced = typeof replacement === "function"
        ? String(replacement(matched, ...args))
        : expandReplacement(replacement, match);
      text += source.slice(last, index);
      origins.push(...this.origins.slice(last, index));
      // Characters a replacement keeps from the start or end of its match
      // (capture groups such as "$1[private]") keep their origin.
      let prefix = 0;
      while (prefix < matched.length && prefix < replaced.length && matched[prefix] === replaced[prefix]) prefix += 1;
      if (prefix > 0 && isHighSurrogate(matched.charCodeAt(prefix - 1))) prefix -= 1;
      let suffix = 0;
      while (suffix < matched.length - prefix && suffix < replaced.length - prefix &&
        matched[matched.length - 1 - suffix] === replaced[replaced.length - 1 - suffix]) suffix += 1;
      if (suffix > 0 && isLowSurrogate(matched.charCodeAt(matched.length - suffix))) suffix -= 1;
      text += replaced;
      for (let offset = 0; offset < replaced.length; offset += 1) {
        if (offset < prefix) origins.push(this.origins[index + offset]);
        else if (offset >= replaced.length - suffix) {
          origins.push(this.origins[index + matched.length - (replaced.length - offset)]);
        } else origins.push(-1);
      }
      last = index + matched.length;
      if (matched.length === 0) regex.lastIndex += 1;
    }
    text += source.slice(last);
    origins.push(...this.origins.slice(last));
    return new TrackedText(text, origins);
  }
}

/** Cover everything between the first and last changed character. */
function coarseRange(text: string, sanitized: string): RedactionRange[] {
  let start = 0;
  while (start < text.length && start < sanitized.length && text[start] === sanitized[start]) start += 1;
  let suffix = 0;
  while (suffix < text.length - start && suffix < sanitized.length - start &&
    text[text.length - 1 - suffix] === sanitized[sanitized.length - 1 - suffix]) suffix += 1;
  const end = text.length - suffix;
  return end > start ? [{ start, end, label: sanitized.slice(start, sanitized.length - suffix) }] : [];
}

/**
 * Find the character ranges of `text` that `redact` hides, and the replacement
 * label for each. Fails closed: if the redactor cannot be tracked or throws,
 * the whole changed span (or the whole line) is reported.
 */
export function findRedactions(text: string, redact: (text: string) => string): RedactionRange[] {
  let sanitized: string;
  try {
    sanitized = redact(text);
  } catch {
    return text ? [{ start: 0, end: text.length, label: "[hidden]" }] : [];
  }
  if (sanitized === text) return [];

  let tracked: unknown;
  try {
    tracked = redact(new TrackedText(text, Array.from({ length: text.length }, (_unused, index) => index)) as unknown as string);
  } catch {
    return coarseRange(text, sanitized);
  }
  if (!(tracked instanceof TrackedText) || tracked.toString() !== sanitized) {
    return coarseRange(text, sanitized);
  }

  const kept = new Uint8Array(text.length);
  for (const origin of tracked.origins) if (origin >= 0) kept[origin] = 1;
  const ranges: RedactionRange[] = [];
  let cursor = 0;
  for (let index = 0; index < text.length;) {
    if (kept[index]) { index += 1; continue; }
    const start = index;
    while (index < text.length && !kept[index]) index += 1;
    // The label is the inserted text that sits where the hidden run was. Skip
    // kept characters and any inserted text that belongs before this run.
    while (cursor < tracked.origins.length) {
      if (tracked.origins[cursor] >= 0) {
        if (tracked.origins[cursor] >= start) break;
        cursor += 1;
        continue;
      }
      let after = cursor;
      while (after < tracked.origins.length && tracked.origins[after] < 0) after += 1;
      if (after < tracked.origins.length && tracked.origins[after] < start) cursor = after;
      else break;
    }
    let label = "";
    while (cursor < tracked.origins.length && tracked.origins[cursor] < 0) {
      label += sanitized[cursor];
      cursor += 1;
    }
    ranges.push({ start, end: index, label });
  }
  return ranges;
}

/** Fit a mask label into `width` terminal cells. */
export function fitMaskLabel(label: string, width: number): string {
  const chars = Array.from(label);
  if (chars.length <= width) return label;
  if (width <= 1) return "…".slice(0, width);
  return `${chars.slice(0, width - 1).join("")}…`;
}

export type CellSpan = { row: number; column: number; width: number; start: number; end: number };

export type LogicalLine = { text: string; cells: CellSpan[]; nextRow: number };

/**
 * The text a selection copies from one logical line with Stream mode masks
 * applied. Masks come from the whole line, so selecting part of a hidden value
 * copies its label rather than the visible-looking fragment.
 */
export function maskedSelectionText(
  line: LogicalLine,
  ranges: RedactionRange[],
  isSelected: (row: number, column: number) => boolean
): string {
  let text = "";
  const labelled = new Set<RedactionRange>();
  for (const cell of line.cells) {
    if (!isSelected(cell.row, cell.column)) continue;
    const range = ranges.find((candidate) => cell.start < candidate.end && cell.end > candidate.start);
    if (!range) text += line.text.slice(cell.start, cell.end);
    else if (!labelled.has(range)) {
      labelled.add(range);
      text += range.label;
    }
  }
  return text.trimEnd();
}

// Read one logical (unwrapped) line starting at `row`, recording which buffer
// cell each UTF-16 offset of its text came from.
function readLogicalLine(terminal: Terminal, row: number): LogicalLine {
  const buffer = terminal.buffer.active;
  let text = "";
  const cells: CellSpan[] = [];
  do {
    const line = buffer.getLine(row);
    const next = buffer.getLine(row + 1);
    const continued = Boolean(next?.isWrapped);
    if (line) {
      let lastColumn = terminal.cols - 1;
      if (!continued) {
        while (lastColumn >= 0 && !line.getCell(lastColumn)?.getChars()) lastColumn -= 1;
      } else if (next?.getCell(0)?.getWidth() === 2 && !line.getCell(lastColumn)?.getChars()) {
        // xterm leaves the final cell empty when a wide character wraps.
        lastColumn -= 1;
      }
      for (let column = 0; column <= lastColumn; column += 1) {
        const cell = line.getCell(column);
        if (!cell || cell.getWidth() === 0) continue;
        const value = cell.getChars() || " ";
        cells.push({ row, column, width: cell.getWidth(), start: text.length, end: text.length + value.length });
        text += value;
      }
    }
    row += 1;
  } while (row < buffer.length && buffer.getLine(row)?.isWrapped);
  return { text, cells, nextRow: row };
}

type MaskedLine = { marker: IMarker; resources: Array<{ dispose(): void }> };

const RANGE_CACHE_LIMIT = 20_000;

export type StreamMaskController = {
  /** Mask with `redact`, or remove every mask when null. Applies synchronously. */
  setRedactor(redact: ((text: string) => string) | null): void;
  /** Re-scan rows that may have changed since the last scan. */
  sync(): void;
  /** The current selection as it should be copied, masked while Stream mode is on. */
  copySelection(): string;
  dispose(): void;
};

/**
 * Paint Stream mode masks over a live xterm instead of replacing it, so the
 * terminal keeps its colours, wrapping, scrolling, selection and input.
 * Requires `allowProposedApi` (markers and decorations) and an opened terminal.
 *
 * Masks are registered synchronously from xterm's parse and resize events,
 * which fire before the render frame that paints the new text, so a masked
 * value is never drawn unmasked. xterm does not draw decorations on the
 * alternate screen (vim, less, full-screen TUIs), so that screen is covered
 * entirely while Stream mode is on.
 */
export function attachStreamMasks(terminal: Terminal): StreamMaskController {
  let redact: ((text: string) => string) | null = null;
  let lines: MaskedLine[] = [];
  // Resizes reflow lines without changing their text, so a full rescan mostly
  // re-reads cached ranges. Cleared whenever the redactor changes.
  let rangeCache = new Map<string, RedactionRange[]>();
  const rangesFor = (text: string, current: (text: string) => string) => {
    let ranges = rangeCache.get(text);
    if (!ranges) {
      ranges = findRedactions(text, current);
      if (rangeCache.size >= RANGE_CACHE_LIMIT) rangeCache = new Map();
      rangeCache.set(text, ranges);
    }
    return ranges;
  };
  // Rows from the viewport top down can still change; rows above it are
  // scrollback and are final. A marker keeps that boundary through trimming.
  let dirtyFrom: IMarker | null = null;

  const cover = document.createElement("div");
  cover.setAttribute("role", "status");
  cover.textContent = "Full-screen output is hidden in Stream mode";
  Object.assign(cover.style, {
    position: "absolute",
    inset: "0",
    zIndex: "20",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    padding: "12px",
    textAlign: "center",
    fontSize: "12px"
  } satisfies Partial<CSSStyleDeclaration>);
  terminal.element?.appendChild(cover);

  const themeColors = () => ({
    background: terminal.options.theme?.background ?? "#15181d",
    muted: terminal.options.theme?.brightBlack ?? "#71717a"
  });

  const updateCover = () => {
    const hidden = redact !== null && terminal.buffer.active.type === "alternate";
    const { background, muted } = themeColors();
    cover.style.background = background;
    cover.style.color = muted;
    cover.style.display = hidden ? "flex" : "none";
  };

  const clearFrom = (row: number) => {
    const keep: MaskedLine[] = [];
    for (const entry of lines) {
      if (!entry.marker.isDisposed && entry.marker.line < row) keep.push(entry);
      else for (const resource of entry.resources.splice(0).reverse()) resource.dispose();
    }
    lines = keep;
  };

  const markRow = (row: number): IMarker | undefined => {
    const buffer = terminal.buffer.active;
    return terminal.registerMarker(row - (buffer.baseY + buffer.cursorY));
  };

  const maskLine = (line: LogicalLine, ranges: RedactionRange[]) => {
    for (const range of ranges) {
      const spans = new Map<number, { start: number; end: number }>();
      for (const cell of line.cells) {
        if (cell.end <= range.start || cell.start >= range.end) continue;
        const span = spans.get(cell.row);
        if (span) span.end = cell.column + cell.width;
        else spans.set(cell.row, { start: cell.column, end: cell.column + cell.width });
      }
      let first = true;
      for (const [row, span] of spans) {
        const marker = markRow(row);
        if (!marker) continue;
        const entry: MaskedLine = { marker, resources: [marker] };
        lines.push(entry);
        const width = span.end - span.start;
        const label = first ? fitMaskLabel(range.label, width) : "";
        first = false;
        const decoration: IDecoration | undefined = terminal.registerDecoration({
          marker,
          x: span.start,
          width,
          layer: "top"
        });
        if (!decoration) continue;
        entry.resources.push(decoration);
        entry.resources.push(decoration.onRender((element) => {
          const { background, muted } = themeColors();
          element.style.background = `linear-gradient(rgb(255 255 255 / 0.07), rgb(255 255 255 / 0.07)), ${background}`;
          element.style.color = muted;
          element.style.overflow = "hidden";
          element.style.whiteSpace = "pre";
          element.style.pointerEvents = "none";
          element.style.fontFamily = terminal.options.fontFamily ?? "monospace";
          element.style.fontSize = `${terminal.options.fontSize ?? 13}px`;
          if (element.textContent !== label) element.textContent = label;
        }));
      }
    }
  };

  const scanFrom = (fromRow: number) => {
    const buffer = terminal.buffer.active;
    let row = Math.max(0, Math.min(fromRow, buffer.length - 1));
    while (row > 0 && buffer.getLine(row)?.isWrapped) row -= 1;
    clearFrom(row);
    if (redact) {
      while (row < buffer.length) {
        const line = readLogicalLine(terminal, row);
        if (line.text) maskLine(line, rangesFor(line.text, redact));
        row = line.nextRow;
      }
    }
    dirtyFrom?.dispose();
    dirtyFrom = markRow(buffer.baseY) ?? null;
  };

  const sync = () => {
    updateCover();
    if (!redact || terminal.buffer.active.type !== "normal") return;
    scanFrom(dirtyFrom && !dirtyFrom.isDisposed ? dirtyFrom.line : 0);
  };

  const rescanAll = () => {
    clearFrom(0);
    dirtyFrom?.dispose();
    dirtyFrom = null;
    sync();
  };

  const copySelection = () => {
    const raw = terminal.getSelection();
    const position = terminal.getSelectionPosition();
    if (!redact || !position) return raw;
    // The full-screen cover hides everything on the alternate screen.
    if (terminal.buffer.active.type !== "normal") return "";
    // xterm reports 0-based cells with an exclusive end column.
    const { start, end } = position;
    const isSelected = (row: number, column: number) =>
      (row > start.y || (row === start.y && column >= start.x)) &&
      (row < end.y || (row === end.y && column < end.x));
    const buffer = terminal.buffer.active;
    let row = start.y;
    while (row > 0 && buffer.getLine(row)?.isWrapped) row -= 1;
    const copied: string[] = [];
    while (row <= end.y && row < buffer.length) {
      const line = readLogicalLine(terminal, row);
      const ranges = line.text ? rangesFor(line.text, redact) : [];
      copied.push(maskedSelectionText(line, ranges, isSelected).replace(/\u00a0/g, " "));
      row = line.nextRow;
    }
    return copied.join(raw.includes("\r\n") ? "\r\n" : "\n");
  };

  const subscriptions = [
    terminal.onWriteParsed(sync),
    terminal.onResize(rescanAll),
    terminal.buffer.onBufferChange(sync)
  ];

  return {
    setRedactor(next) {
      if (next === redact) return;
      redact = next;
      rangeCache = new Map();
      if (redact) rescanAll();
      else {
        clearFrom(0);
        dirtyFrom?.dispose();
        dirtyFrom = null;
        updateCover();
      }
    },
    sync,
    copySelection,
    dispose() {
      for (const subscription of subscriptions) subscription.dispose();
      clearFrom(0);
      dirtyFrom?.dispose();
      cover.remove();
    }
  };
}
