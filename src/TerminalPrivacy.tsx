import { useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";

const TERMINAL_KEY_SEQUENCES: Readonly<Record<string, string>> = {
  Enter: "\r",
  Backspace: "\x7f",
  Tab: "\t",
  Escape: "\x1b",
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  Delete: "\x1b[3~",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~"
};

const MIRROR_BOTTOM_THRESHOLD = 24;

export type TerminalPrivacyProps = {
  /** Keep the raw terminal hidden and render the sanitized mirror instead. */
  redacted?: boolean;
  /** Backwards-compatible name used by existing terminal parents. */
  concealed?: boolean;
  /** Plain-text, already-sanitized terminal output shown while redacted. */
  content?: string;
  /** Allow terminal-like key handling and paste forwarding on the mirror. */
  interactive?: boolean;
  /** Receives terminal input bytes, including pasted text when onPaste is omitted. */
  onData?: (data: string) => void;
  /** Optional separate paste handler. Defaults to onData. */
  onPaste?: (text: string) => void;
  /** Accessible name for the mirror surface. */
  ariaLabel?: string;
  children: ReactNode;
};

function controlByte(key: string): string | null {
  const lower = key.toLowerCase();
  if (lower.length !== 1 || lower < "a" || lower > "z") {
    return null;
  }
  return String.fromCharCode(lower.charCodeAt(0) - 96);
}

function hasMirrorSelection(mirror: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.toString().length === 0) {
    return false;
  }
  if (selection.rangeCount === 0) {
    return false;
  }
  const range = selection.getRangeAt(0);
  return (
    mirror.contains(selection.anchorNode) ||
    mirror.contains(selection.focusNode) ||
    mirror.contains(range.commonAncestorContainer)
  );
}

/**
 * Keep xterm measurable and mounted, but replace its visible surface with a
 * plain-text stream mirror whenever privacy redaction is active.
 */
export function TerminalPrivacy({
  redacted,
  concealed,
  content = "",
  interactive = false,
  onData,
  onPaste,
  ariaLabel = "Sanitized terminal output",
  children
}: TerminalPrivacyProps) {
  const isRedacted = redacted ?? concealed ?? false;
  const mirrorRef = useRef<HTMLPreElement | null>(null);
  const followsBottomRef = useRef(true);
  const wasRedactedRef = useRef(false);

  // Inline visibility is applied in the React commit itself. This layout
  // effect only maintains scroll position after the new snapshot is painted
  // into the mirror, avoiding a visible jump when live output appends.
  useLayoutEffect(() => {
    if (!isRedacted) {
      wasRedactedRef.current = false;
      return;
    }

    const mirror = mirrorRef.current;
    if (!mirror) {
      return;
    }

    if (!wasRedactedRef.current || followsBottomRef.current) {
      mirror.scrollTop = mirror.scrollHeight;
    }
    wasRedactedRef.current = true;
  }, [content, isRedacted]);

  function handleMirrorScroll() {
    const mirror = mirrorRef.current;
    if (!mirror) {
      return;
    }
    followsBottomRef.current =
      mirror.scrollHeight - mirror.scrollTop - mirror.clientHeight <= MIRROR_BOTTOM_THRESHOLD;
  }

  function forwardData(data: string, event: KeyboardEvent<HTMLPreElement> | ClipboardEvent<HTMLPreElement>) {
    if (!data || !onData) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    onData(data);
    return true;
  }

  function handleMirrorKeyDown(event: KeyboardEvent<HTMLPreElement>) {
    if (!interactive || !onData || event.isComposing) {
      return;
    }

    const key = event.key;
    const hasCopySelection =
      (event.ctrlKey || event.metaKey) && key.toLowerCase() === "c" && hasMirrorSelection(event.currentTarget);
    if (hasCopySelection) {
      // Leave the browser's native copy gesture intact for selected sanitized
      // text. Ctrl+C with no selection remains the terminal interrupt byte.
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key.toLowerCase() === "v") {
      // Preserve the browser paste gesture so onPaste can route the text
      // through xterm's own paste encoder, including bracketed-paste mode.
      return;
    }

    let data: string | null = null;
    if (event.ctrlKey && !event.metaKey && !event.altKey) {
      data = controlByte(key);
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      data = TERMINAL_KEY_SEQUENCES[key] ?? (key.length === 1 ? key : null);
    } else if (event.altKey && !event.ctrlKey && !event.metaKey && key.length === 1) {
      // Meta-prefixed printable input is the conventional terminal encoding
      // for Alt+key while leaving Cmd shortcuts to the host application.
      data = `\x1b${key}`;
    }

    if (data !== null) {
      forwardData(data, event);
    }
  }

  function handleMirrorPaste(event: ClipboardEvent<HTMLPreElement>) {
    if (!interactive) {
      return;
    }
    const callback = onPaste ?? onData;
    const text = event.clipboardData.getData("text/plain");
    if (!callback || !text) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    callback(text);
  }

  return (
    <div className="relative h-full w-full">
      <div
        className="h-full w-full"
        // Keep this style in the render path so the xterm surface is hidden in
        // the same commit that applies aria-hidden/inert, before the next paint.
        style={isRedacted ? { visibility: "hidden" } : undefined}
        aria-hidden={isRedacted || undefined}
        inert={isRedacted || undefined}
        data-terminal-content
      >
        {children}
      </div>
      {isRedacted ? (
        <pre
          ref={mirrorRef}
          tabIndex={0}
          role="region"
          aria-label={ariaLabel}
          spellCheck={false}
          onScroll={handleMirrorScroll}
          onKeyDown={handleMirrorKeyDown}
          onPaste={handleMirrorPaste}
          data-terminal-mirror
          className="absolute inset-0 overflow-auto overscroll-contain bg-[var(--muxly-terminal-bg)] p-3 font-mono text-[13px] leading-[1.45] text-zinc-300 outline-none select-text focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/40"
        >
          {content}
        </pre>
      ) : null}
    </div>
  );
}
