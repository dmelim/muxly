import { useLayoutEffect, useRef, type ClipboardEvent, type KeyboardEvent, type ReactNode } from "react";
import { isAppModifier, isMac } from "./appUtils";

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
  if (key === " " || key === "@") return "\x00";
  if (key.length === 1 && key >= "[" && key <= "_") {
    return String.fromCharCode(key.charCodeAt(0) - 64);
  }
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
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const composingRef = useRef(false);
  const compositionCommitRef = useRef<string | null>(null);
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

  function forwardData(data: string, event: KeyboardEvent<HTMLElement> | ClipboardEvent<HTMLElement>) {
    if (!data || !onData) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    onData(data);
    return true;
  }

  function handleMirrorKeyDown(event: KeyboardEvent<HTMLElement>) {
    // Selection leaves focus on the output surface. Move subsequent typing
    // back to native input, preserving copy and paste on the selected output.
    if (interactive && event.currentTarget === mirrorRef.current && !event.ctrlKey && !event.metaKey) {
      inputRef.current?.focus({ preventScroll: true });
      if (!event.nativeEvent.isComposing && !event.altKey && event.key.length === 1) {
        forwardData(event.key, event);
        return;
      }
    }
    if (!interactive || !onData || composingRef.current || event.nativeEvent.isComposing) {
      return;
    }

    const key = event.key;
    compositionCommitRef.current = null;
    const hasCopySelection =
      isAppModifier(event) && key.toLowerCase() === "c" && mirrorRef.current !== null && hasMirrorSelection(mirrorRef.current);
    if (hasCopySelection) {
      // Leave the browser's native copy gesture intact for selected sanitized
      // text. Ctrl+C with no selection remains the terminal interrupt byte.
      return;
    }
    if (isAppModifier(event) && key.toLowerCase() === "v") {
      // Preserve the browser paste gesture so onPaste can route the text
      // through xterm's own paste encoder, including bracketed-paste mode.
      return;
    }

    let data: string | null = null;
    if (event.ctrlKey && !event.metaKey && !event.altKey) {
      data = controlByte(key);
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      data = TERMINAL_KEY_SEQUENCES[key] ?? null;
    } else if (!isMac && event.altKey && !event.ctrlKey && !event.metaKey && key.length === 1) {
      // Meta-prefixed printable input is the conventional terminal encoding
      // for Alt+key while leaving Cmd shortcuts to the host application.
      data = `\x1b${key}`;
    }

    if (data !== null) {
      forwardData(data, event);
    }
  }

  function focusInput() {
    if (interactive && mirrorRef.current && !hasMirrorSelection(mirrorRef.current)) {
      inputRef.current?.focus({ preventScroll: true });
    }
  }

  function commitInput(input: HTMLTextAreaElement) {
    if (composingRef.current) return;
    const text = input.value;
    input.value = "";
    // WebKit can deliver a final input event after compositionend. The text
    // was already forwarded there; never send the committed word twice.
    if (text === compositionCommitRef.current) {
      compositionCommitRef.current = null;
      return;
    }
    compositionCommitRef.current = null;
    if (interactive && text) onData?.(text);
  }

  function handleMirrorCopy(event: ClipboardEvent<HTMLElement>) {
    if (mirrorRef.current && hasMirrorSelection(mirrorRef.current)) {
      event.preventDefault();
      event.clipboardData.setData("text/plain", window.getSelection()?.toString() ?? "");
    }
  }

  function handleMirrorPaste(event: ClipboardEvent<HTMLElement>) {
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
    <div className="group/terminal-input relative h-full w-full">
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
      {isRedacted ? (<>
        <pre
          ref={mirrorRef}
          tabIndex={0}
          role="region"
          aria-label={ariaLabel}
          spellCheck={false}
          onScroll={handleMirrorScroll}
          onKeyDown={handleMirrorKeyDown}
          onPaste={handleMirrorPaste}
          onCopy={handleMirrorCopy}
          onFocus={focusInput}
          onMouseUp={focusInput}
          data-terminal-mirror
          className="absolute inset-0 overflow-auto overscroll-contain bg-[var(--muxly-terminal-bg)] p-3 font-mono text-[13px] leading-[1.45] text-zinc-300 outline-none select-text focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-400/40 group-focus-within/terminal-input:ring-2 group-focus-within/terminal-input:ring-inset group-focus-within/terminal-input:ring-cyan-400/40"
        >
          {content}
        </pre>
        {interactive ? (
          <textarea
            ref={inputRef}
            tabIndex={-1}
            aria-label={`${ariaLabel} input`}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            autoComplete="off"
            data-terminal-mirror
            className="xterm-helper-textarea pointer-events-none absolute left-3 top-3 h-px w-px resize-none border-0 bg-transparent p-0 opacity-0 outline-none"
            onKeyDown={handleMirrorKeyDown}
            onCopy={handleMirrorCopy}
            onPaste={handleMirrorPaste}
            onInput={(event) => {
              if (!(event.nativeEvent as InputEvent).isComposing) commitInput(event.currentTarget);
            }}
            onCompositionStart={() => {
              composingRef.current = true;
              compositionCommitRef.current = null;
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              const text = event.currentTarget.value;
              commitInput(event.currentTarget);
              compositionCommitRef.current = text || null;
            }}
          />
        ) : null}
      </>) : null}
    </div>
  );
}
