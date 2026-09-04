import { useEffect, useRef } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { Tooltip } from "./Tooltip";
import { CloseIcon, TerminalIcon } from "./icons";
import { PTY_CLOSED } from "./events";
import type { MuxlyTheme } from "./theme";
import { xtermTheme } from "./theme";

type PtyOutputEvent = { ptyId: string; chunk: string };
type PtyClosedEvent = { ptyId: string };

const TERMINAL_OPTIONS = {
  // No `convertEol` — a real PTY emits proper CRLF for us. Forcing it adds an
  // extra `\r` and produces stair-stepped output on Windows shells.
  cursorBlink: true,
  fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, monospace",
  fontSize: 13,
  lineHeight: 1.45,
  scrollback: 5000
} as const;

type BottomTerminalProps = {
  /** Visible flag — the parent controls open/close so the height transitions
   * happen alongside other layout state, but the terminal mounts only when
   * open so we don't spawn a shell the user never asked for. */
  open: boolean;
  /** Drawer height in pixels — owned by the parent so it survives toggle. */
  height: number;
  theme: MuxlyTheme;
  onClose: () => void;
  /** Begin a vertical drag on the drawer's top edge. The parent runs the
   * window-level mousemove/up handlers so the drag survives the cursor
   * leaving the thin handle. */
  onResizeStart: (event: React.MouseEvent) => void;
};

/**
 * Bottom-drawer interactive shell. Spawns one PTY when the drawer opens and
 * kills it when the drawer closes. If the user wants persistence across
 * close/reopen we can buffer output later — for now "close" really means
 * "end this session", matching VS Code's terminal panel behaviour.
 */
export function BottomTerminal({ open, height, theme, onClose, onResizeStart }: BottomTerminalProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    if (terminalRef.current) terminalRef.current.options.theme = xtermTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const wrap = wrapRef.current;
    const host = hostRef.current;
    if (!wrap || !host) {
      return;
    }

    // A short random id keeps the backend session keyed independently of any
    // user-facing identifier. Multiple shells could share this code later.
    const ptyId = `shell-${Math.random().toString(36).slice(2, 10)}`;

    const terminal = new Terminal({ ...TERMINAL_OPTIONS, theme: xtermTheme(themeRef.current) });
    terminalRef.current = terminal;
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(
      new WebLinksAddon((event, uri) => {
        // Route through the backend `open_url` command — `window.open` from a
        // Tauri webview doesn't reliably hand off to the system browser.
        event.preventDefault();
        void invoke("open_url", { url: uri }).catch(() => {});
      })
    );

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let setupRaf = 0;
    let fitRaf = 0;
    let closeListener: (() => void) | null = null;
    // Holds the onData disposable from inside the rAF callback so the outer
    // cleanup can dispose it even though it's created later.
    const onDataCleanup: { dispose: () => void } = { dispose: () => {} };
    // The `pty_open` invocation. We chain `pty_close` off this in cleanup so a
    // fast open/close toggle can't race the backend into an orphan session —
    // close needs to run *after* open has finished registering.
    let openPromise: Promise<unknown> = Promise.resolve();

    const safeFit = () => {
      if (disposed) return;
      try {
        fitAddon.fit();
      } catch {
        /* element not measurable yet */
      }
    };

    // Send the latest xterm dimensions to the PTY. Throttled to one per frame
    // by the caller via rAF so a drag-resize doesn't fire dozens of IPCs.
    const pushSize = () => {
      if (disposed) return;
      const cols = terminal.cols;
      const rows = terminal.rows;
      if (cols < 1 || rows < 1) return;
      void invoke("pty_resize", { ptyId, cols, rows }).catch(() => {
        /* PTY already closed — the close listener will tidy up */
      });
    };

    // Defer setup one frame so the parent's drawer height has actually applied
    // before we measure cell size — otherwise the first fit() comes out wrong
    // and the shell prompt renders into a tiny grid.
    setupRaf = requestAnimationFrame(() => {
      if (disposed) return;
      terminal.open(host);
      safeFit();

      const onOutput = new Channel<PtyOutputEvent>();
      onOutput.onmessage = (event) => {
        terminal.write(event.chunk);
      };

      openPromise = invoke("pty_open", {
        ptyId,
        cols: terminal.cols || 80,
        rows: terminal.rows || 24,
        // `null` lets the backend pick the user home directory.
        cwd: null,
        onOutput
      }).catch((error) => {
        terminal.write(`\r\n\x1b[31m[shell] failed to start: ${formatError(error)}\x1b[0m\r\n`);
      });

      // Pipe keystrokes to the PTY. xterm hands us a string already encoded
      // with the right control sequences (arrows, Ctrl-C, etc).
      const dataDisposable = terminal.onData((data) => {
        void invoke("pty_write", { ptyId, data }).catch(() => {
          /* dead session — let the close listener mark it gone */
        });
      });

      // The backend emits this when the child exits or the master EOFs.
      void listen<PtyClosedEvent>(PTY_CLOSED, (event) => {
        if (event.payload.ptyId !== ptyId) return;
        terminal.write("\r\n\x1b[36m[shell] session ended\x1b[0m\r\n");
      }).then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          closeListener = unlisten;
        }
      });

      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(fitRaf);
        fitRaf = requestAnimationFrame(() => {
          safeFit();
          pushSize();
        });
      });
      resizeObserver.observe(wrap);

      onDataCleanup.dispose = () => dataDisposable.dispose();
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(setupRaf);
      cancelAnimationFrame(fitRaf);
      resizeObserver?.disconnect();
      closeListener?.();
      onDataCleanup.dispose();
      // Wait for the open IPC to settle before closing. Without this chain,
      // a fast open→close toggle can land pty_close on the backend before
      // pty_open has inserted the session — leaving an orphan shell that
      // outlives the UI.
      void openPromise.finally(() => invoke("pty_close", { ptyId }).catch(() => {}));
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="relative flex shrink-0 flex-col border-t border-white/10 bg-[#101215]"
      style={{ height: `${height}px` }}
    >
      {/* Drag handle: a thin invisible strip overlapping the top border, with
          a hover-revealed accent line. The existing sidebar handles use the
          same pattern. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        onMouseDown={onResizeStart}
        className="group/th absolute inset-x-0 top-0 z-20 h-1.5 -translate-y-1/2 cursor-row-resize"
      >
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors group-hover/th:bg-cyan-500/60" />
      </div>
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/10 pl-3 pr-1.5">
        <span className="flex items-center gap-2 text-xs font-medium text-zinc-300">
          <TerminalIcon className="size-3.5 text-cyan-400" />
          Shell
        </span>
        <Tooltip label="Close terminal (Ctrl+↓)">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close terminal"
            className="rounded p-1 text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
          >
            <CloseIcon className="size-3.5" />
          </button>
        </Tooltip>
      </div>
      <div ref={wrapRef} className="min-h-0 flex-1 overflow-hidden p-3">
        <div ref={hostRef} className="h-full w-full overflow-hidden" />
      </div>
    </div>
  );
}

function formatError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return String(error);
}
