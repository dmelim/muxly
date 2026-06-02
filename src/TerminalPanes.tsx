import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import type { ServiceConfig, ServiceStatus } from "./types";
import { displayServiceName, formatCommand } from "./types";
import { ClearIcon, CloseIcon, PlayIcon, RestartIcon, SearchIcon, StopIcon } from "./icons";
import { Tooltip } from "./Tooltip";

const statusDots: Record<ServiceStatus, string> = {
  stopped: "bg-zinc-600",
  starting: "bg-amber-400",
  running: "bg-cyan-400",
  stopping: "bg-orange-400",
  exited: "bg-sky-400",
  failed: "bg-rose-400"
};

// Mirrors the shortcut label used in App.tsx — `Ctrl` on Linux/Windows, `⌘` on
// macOS — so the close-pane tooltip reads naturally on whichever platform.
const MOD_KEY = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl";

const TERMINAL_OPTIONS = {
  convertEol: true,
  cursorBlink: true,
  fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, monospace",
  fontSize: 13,
  lineHeight: 1.45,
  scrollback: 5000,
  theme: {
    background: "#101215",
    foreground: "#d4d4d8",
    cursor: "#22d3ee",
    selectionBackground: "#3f3f46"
  }
} as const;

type TerminalPanesProps = {
  /** Services shown as panes, left-to-right. */
  paneServices: ServiceConfig[];
  /** The focused pane's service id — drives the toolbar/inspector. */
  focusedId: string | null;
  /** When true, sensitive services show a masked name (stream mode). */
  streamMode: boolean;
  statuses: Record<string, ServiceStatus>;
  /** Live PIDs, keyed by service id — a present pid means the process runs. */
  pids: Record<string, number>;
  /** Max columns before the pane grid wraps to a new row. */
  gridColumns: number;
  /** App-owned registry so log streaming can reach each pane's terminal. */
  terminalsRef: MutableRefObject<Map<string, Terminal>>;
  /** App-owned per-service log ring buffers, replayed when a pane mounts. */
  logsRef: MutableRefObject<Record<string, string[]>>;
  /** Service id whose in-pane search bar should be visible, or null. */
  searchPaneId: string | null;
  /** When set, the named pane opens its search bar pre-filled with `query`
   * — used by the global search modal to highlight the jumped-to phrase.
   * `nonce` lets the same query→same pane jump re-trigger the search. */
  searchSeed: { serviceId: string; query: string; nonce: number } | null;
  /** Service id whose pane should briefly flash amber (jump confirmation). */
  flashServiceId: string | null;
  /** Bumps every time a jump is dispatched, even to the same pane — used
   * to re-fire the flash animation on consecutive clicks of the same hit. */
  flashNonce: number;
  /** Per-service "another process owns my port" record, surfaced as a
   * banner inside the pane with stop-and-restart / adopt actions. */
  portBlockers: Record<string, { pid: number; port: number }>;
  /** Per-service "this foreign process is acting as the service" record.
   * Drives the adopted badge in the pane header. */
  adoptedPids: Record<string, { pid: number; port: number }>;
  onFocus: (serviceId: string) => void;
  onClose: (serviceId: string) => void;
  onStart: (service: ServiceConfig) => void;
  onStop: (service: ServiceConfig) => void;
  onClear: (serviceId: string) => void;
  onOpenSearch: (serviceId: string) => void;
  onCloseSearch: () => void;
  onStopBlockerAndRestart: (service: ServiceConfig) => void;
  onAdoptRunningInstance: (service: ServiceConfig) => void;
  onReleaseAdopted: (serviceId: string) => void;
};

export function TerminalPanes({
  paneServices,
  focusedId,
  streamMode,
  statuses,
  pids,
  gridColumns,
  terminalsRef,
  logsRef,
  searchPaneId,
  searchSeed,
  flashServiceId,
  flashNonce,
  portBlockers,
  adoptedPids,
  onFocus,
  onClose,
  onStart,
  onStop,
  onClear,
  onOpenSearch,
  onCloseSearch,
  onStopBlockerAndRestart,
  onAdoptRunningInstance,
  onReleaseAdopted
}: TerminalPanesProps) {
  if (paneServices.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-zinc-500">
        No service open.
      </div>
    );
  }

  // The grid is column-capped, not column-fixed: with fewer panes than the
  // cap we use one column per pane so each one stays as wide as possible
  // instead of leaving empty cells. Past the cap we wrap to a new row.
  const cols = Math.max(1, Math.min(gridColumns, paneServices.length));

  return (
    <div
      className="grid min-h-0 flex-1 gap-1.5 p-1.5"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridAutoRows: "minmax(0, 1fr)"
      }}
    >
      {paneServices.map((service) => {
        const seed =
          searchSeed && searchSeed.serviceId === service.id ? searchSeed : null;
        const flashing = flashServiceId === service.id;
        return (
          <PaneShell key={service.id} flashing={flashing} flashNonce={flashNonce}>
            <PaneView
              service={service}
              streamMode={streamMode}
              status={statuses[service.id] ?? "stopped"}
              running={pids[service.id] != null || adoptedPids[service.id] != null}
              focused={service.id === focusedId}
              showClose={paneServices.length > 1}
              searchOpen={service.id === searchPaneId}
              searchSeed={seed}
              blocker={portBlockers[service.id] ?? null}
              adopted={adoptedPids[service.id] ?? null}
              terminalsRef={terminalsRef}
              logsRef={logsRef}
              onFocus={() => onFocus(service.id)}
              onClose={() => onClose(service.id)}
              onStart={() => onStart(service)}
              onStop={() => onStop(service)}
              onClear={() => onClear(service.id)}
              onOpenSearch={() => onOpenSearch(service.id)}
              onCloseSearch={onCloseSearch}
              onStopBlockerAndRestart={() => onStopBlockerAndRestart(service)}
              onAdoptRunningInstance={() => onAdoptRunningInstance(service)}
              onReleaseAdopted={() => onReleaseAdopted(service.id)}
            />
          </PaneShell>
        );
      })}
    </div>
  );
}

// Thin wrapper around each pane that runs a one-shot amber background
// flash via the Web Animations API. Using WAAPI (instead of a CSS class)
// keeps consecutive jumps to the *same* pane working: each flashNonce
// bump re-runs the effect even when `flashing` itself doesn't change,
// and `element.animate()` always restarts the animation regardless of
// the prior state. Doing this in a wrapper component (not a key on the
// pane div) keeps the inner terminal and its scrollback intact.
function PaneShell({
  flashing,
  flashNonce,
  children
}: {
  flashing: boolean;
  flashNonce: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!flashing) return;
    const node = ref.current;
    if (!node) return;
    const animation = node.animate(
      [
        { backgroundColor: "rgba(251, 191, 36, 0.28)" },
        { backgroundColor: "transparent" }
      ],
      { duration: 1200, easing: "ease-out" }
    );
    return () => animation.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashing, flashNonce]);

  return (
    <div
      ref={ref}
      className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-white/5"
    >
      {children}
    </div>
  );
}

// Amber recovery banner inside a pane when its configured port is held by
// a foreign process. Offers two actions: kill-and-restart (we own the
// process going forward) and adopt (treat the foreign PID as the service
// for status purposes, without capturing its IO).
function PortBlockerBanner({
  pid,
  port,
  onStopBlockerAndRestart,
  onAdoptRunningInstance
}: {
  pid: number;
  port: number;
  onStopBlockerAndRestart: () => void;
  onAdoptRunningInstance: () => void;
}) {
  return (
    <div
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100"
      // Don't let clicks inside the banner steal pane focus from a Stop
      // button two pixels away.
      onMouseDown={(event) => event.stopPropagation()}
    >
      <span className="min-w-0 flex-1">
        <span className="font-medium">Port {port} is already in use</span>
        <span className="text-amber-200/70"> · pid {pid} owns it now.</span>
      </span>
      <span className="flex shrink-0 gap-1.5">
        <button
          type="button"
          onClick={onStopBlockerAndRestart}
          className="rounded border border-amber-400/50 bg-amber-500/20 px-2 py-1 text-[11px] font-medium text-amber-50 transition hover:bg-amber-500/30"
        >
          Stop pid {pid} and restart
        </button>
        <button
          type="button"
          onClick={onAdoptRunningInstance}
          className="rounded border border-cyan-400/40 bg-cyan-500/10 px-2 py-1 text-[11px] font-medium text-cyan-100 transition hover:bg-cyan-500/20"
        >
          Adopt running instance
        </button>
      </span>
    </div>
  );
}

type PaneViewProps = {
  service: ServiceConfig;
  /** When true and the service is sensitive, its name is masked in the header. */
  streamMode: boolean;
  status: ServiceStatus;
  /** True while the process has a live PID — gates the Stop button. */
  running: boolean;
  focused: boolean;
  showClose: boolean;
  /** Whether the in-pane search bar should be shown for this pane. */
  searchOpen: boolean;
  /** Pre-fill the in-pane search bar with this query — non-null when the
   * global search modal jumped to this pane. */
  searchSeed: { query: string; nonce: number } | null;
  /** Foreign-process port conflict info; non-null shows the recovery banner. */
  blocker: { pid: number; port: number } | null;
  /** Adopted foreign process info; non-null shows the adopted header badge. */
  adopted: { pid: number; port: number } | null;
  terminalsRef: MutableRefObject<Map<string, Terminal>>;
  logsRef: MutableRefObject<Record<string, string[]>>;
  onFocus: () => void;
  onClose: () => void;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
  onOpenSearch: () => void;
  onCloseSearch: () => void;
  onStopBlockerAndRestart: () => void;
  onAdoptRunningInstance: () => void;
  onReleaseAdopted: () => void;
};

function PaneView({
  service,
  streamMode,
  status,
  running,
  focused,
  showClose,
  searchOpen,
  searchSeed,
  blocker,
  adopted,
  terminalsRef,
  logsRef,
  onFocus,
  onClose,
  onStart,
  onStop,
  onClear,
  onOpenSearch,
  onCloseSearch,
  onStopBlockerAndRestart,
  onAdoptRunningInstance,
  onReleaseAdopted
}: PaneViewProps) {
  // `wrapRef` is the flex-sized box the ResizeObserver watches. `hostRef` is a
  // plain child that xterm renders into. Keeping them separate is what stops
  // the flicker: if the observer watched the same element xterm draws into,
  // `fit()` would perturb that element's box and re-trigger the observer in a
  // self-sustaining loop.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  // The SearchAddon is held in state (not just a ref) so the PaneSearchBar
  // re-renders once it becomes available after the deferred terminal open.
  const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null);
  // The terminal-open effect runs once (empty deps); this ref lets it read the
  // current stream-mode state when it writes the one-time name banner, so a
  // pane opened while stream mode is on starts masked. Toggling stream mode
  // later updates the header (reactive) but not already-written scrollback.
  const streamModeRef = useRef(streamMode);
  streamModeRef.current = streamMode;

  // One terminal per pane, created once. The pane is keyed by service id in the
  // parent, so this component instance maps 1:1 to a service for its lifetime.
  useEffect(() => {
    const wrap = wrapRef.current;
    const host = hostRef.current;
    if (!wrap || !host) {
      return;
    }

    // PTY services emit a real CRLF, so `convertEol` (which the pipe path needs
    // to turn bare `\n` into `\r\n`) would add a second `\r` and stair-step the
    // output. Disable it for PTY panes; xterm renders their ANSI colours,
    // spinners, and clear-screen sequences natively.
    const isPty = service.usePty;
    const terminal = new Terminal({ ...TERMINAL_OPTIONS, convertEol: !isPty });
    const fitAddon = new FitAddon();
    const search = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(search);
    terminal.loadAddon(
      new WebLinksAddon((event, uri) => {
        // Go through the Rust `open_url` command (same one the inspector's
        // "Open localhost:N" button uses). `window.open` inside a Tauri
        // webview isn't reliably routed to the system browser across OSes —
        // the OS-shell call is.
        event.preventDefault();
        void invoke("open_url", { url: uri }).catch(() => {
          /* nothing useful to surface to the user here */
        });
      })
    );

    let resizeObserver: ResizeObserver | null = null;
    let disposed = false;
    let setupRaf = 0;
    let fitRaf = 0;
    // Pipe keystrokes to the service's PTY (read-only pipe services have no
    // writer, so we only wire this up for PTY panes). xterm hands us a string
    // already encoded with the right control sequences; the PTY echoes input
    // back through the normal output stream, so we don't echo locally.
    let dataDisposable: { dispose: () => void } | null = null;
    if (isPty) {
      dataDisposable = terminal.onData((data) => {
        void invoke("service_pty_write", { serviceId: service.id, data }).catch(() => {
          /* not running / session gone — nothing useful to surface */
        });
      });
    }

    const safeFit = () => {
      if (disposed) {
        return;
      }
      try {
        fitAddon.fit();
      } catch {
        /* element not measurable yet */
      }
    };

    // Tell the PTY its new dimensions so tools that probe COLUMNS/LINES and
    // redraw against the window stay aligned with the pane. No-op for pipe
    // services. Throttled to one call per frame by the rAF caller below.
    const pushSize = () => {
      if (disposed || !isPty) {
        return;
      }
      const { cols, rows } = terminal;
      if (cols < 1 || rows < 1) {
        return;
      }
      void invoke("service_pty_resize", { serviceId: service.id, cols, rows }).catch(() => {
        /* not running — the next resize after start will sync it */
      });
    };

    // Defer open/fit/write to the next frame. A pane's mount effect runs
    // before the parent grid has applied final cell widths — fitting and
    // writing here would size the terminal wrong and the replayed log would
    // render garbled. By the next frame the layout has settled.
    setupRaf = requestAnimationFrame(() => {
      if (disposed) {
        return;
      }
      terminal.open(host);
      safeFit();
      // Sync the freshly-measured size to the PTY (the backend spawns at a
      // default 120x30 until we know the pane's real dimensions).
      pushSize();

      terminal.writeln(
        `\x1b[1;38;2;34;211;238m${displayServiceName(service, streamModeRef.current)}\x1b[0m`
      );
      terminal.writeln(`cwd: ${service.cwd}`);
      terminal.writeln(`cmd: ${formatCommand(service)}`);
      terminal.writeln("");
      for (const chunk of logsRef.current[service.id] ?? []) {
        terminal.write(chunk);
      }

      // Register only after the replay, so live output appends in order.
      terminalsRef.current.set(service.id, terminal);
      setSearchAddon(search);

      // Debounce fits to one per frame — extra insurance against rapid
      // resize bursts (e.g. while dragging a pane divider).
      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(fitRaf);
        fitRaf = requestAnimationFrame(() => {
          safeFit();
          pushSize();
        });
      });
      resizeObserver.observe(wrap);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(setupRaf);
      cancelAnimationFrame(fitRaf);
      resizeObserver?.disconnect();
      dataDisposable?.dispose();
      terminalsRef.current.delete(service.id);
      setSearchAddon(null);
      terminal.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      onMouseDown={onFocus}
      className={`flex min-h-0 flex-1 flex-col ${
        focused ? "ring-1 ring-inset ring-cyan-500/30" : ""
      }`}
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-white/10 pl-3 pr-1.5">
        <span className="flex min-w-0 items-center gap-2">
          {/* Adopted services show a cyan dot regardless of the underlying
              ServiceStatus, since the foreign process is what's actually
              listening on the port right now. */}
          <span
            className={`size-2 rounded-full ${
              adopted ? "bg-cyan-400" : statusDots[status]
            }`}
          />
          <span
            className={`truncate text-xs font-medium ${
              focused ? "text-zinc-100" : "text-zinc-400"
            }`}
          >
            {displayServiceName(service, streamMode)}
          </span>
          {adopted ? (
            <Tooltip label="External process adopted — Muxly did not spawn this PID, so its stdout/stderr are not captured.">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onReleaseAdopted();
                }}
                aria-label="Release adopted process (does not kill it)"
                className="flex shrink-0 items-center gap-1 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-200 transition hover:bg-cyan-500/20"
              >
                <span>adopted · pid {adopted.pid}</span>
                <CloseIcon className="size-2.5 opacity-70" />
              </button>
            </Tooltip>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          {status === "failed" || status === "exited" ? (
            <PaneIconButton
              label="Restart"
              accent="text-amber-400 hover:bg-amber-500/15 hover:text-amber-300"
              onClick={onStart}
            >
              <RestartIcon className="size-3.5" />
            </PaneIconButton>
          ) : (
            <PaneIconButton
              label="Start"
              accent="text-cyan-400 hover:bg-cyan-500/15 hover:text-cyan-300"
              disabled={status === "running" || status === "starting"}
              onClick={onStart}
            >
              <PlayIcon className="size-3.5" />
            </PaneIconButton>
          )}
          <PaneIconButton
            label="Stop"
            accent="text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
            disabled={!running}
            onClick={onStop}
          >
            <StopIcon className="size-3.5" />
          </PaneIconButton>
          <PaneIconButton
            label={`Find in pane (${MOD_KEY}+F)`}
            accent={
              searchOpen
                ? "text-cyan-400 bg-cyan-500/15 hover:bg-cyan-500/20"
                : "text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
            }
            onClick={searchOpen ? onCloseSearch : onOpenSearch}
          >
            <SearchIcon className="size-3.5" />
          </PaneIconButton>
          <PaneIconButton
            label="Clear log"
            accent="text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
            onClick={onClear}
          >
            <ClearIcon className="size-3.5 rotate-12" />
          </PaneIconButton>
          {showClose ? (
            <>
              <span className="mx-0.5 h-4 w-px bg-white/10" />
              <PaneIconButton
                label={`Close (${MOD_KEY}+W)`}
                accent="text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                onClick={onClose}
              >
                <CloseIcon className="size-3.5" />
              </PaneIconButton>
            </>
          ) : null}
        </span>
      </div>
      {blocker ? (
        <PortBlockerBanner
          pid={blocker.pid}
          port={blocker.port}
          onStopBlockerAndRestart={onStopBlockerAndRestart}
          onAdoptRunningInstance={onAdoptRunningInstance}
        />
      ) : null}
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden p-3">
        <div ref={hostRef} className="h-full w-full overflow-hidden" />
        {searchOpen && searchAddon ? (
          <PaneSearchBar
            searchAddon={searchAddon}
            seed={searchSeed}
            onClose={onCloseSearch}
          />
        ) : null}
      </div>
    </div>
  );
}

// In-pane find. xterm's SearchAddon owns the actual matching/decoration work;
// this is just a small overlay that drives it and surfaces the live result
// count via `onDidChangeResults`. Esc closes (clearing decorations), Enter
// jumps to the next match, Shift+Enter jumps to the previous.
function PaneSearchBar({
  searchAddon,
  seed,
  onClose
}: {
  searchAddon: SearchAddon;
  seed: { query: string; nonce: number } | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(seed?.query ?? "");

  // When a new seed arrives (e.g. another global-search jump to this same
  // pane while the bar is already open), adopt its query so the highlight
  // moves to the freshly chosen phrase.
  useEffect(() => {
    if (seed && seed.query) {
      setQuery(seed.query);
    }
    // We key on `nonce` so consecutive jumps with the same query still
    // re-run the live-search effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce]);
  const [results, setResults] = useState<{ resultIndex: number; resultCount: number }>({
    resultIndex: -1,
    resultCount: 0
  });
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Amber decorations — distinct from the cyan brand accent used for focus
  // rings/status indicators, so a highlighted phrase reads clearly as
  // "search hit" rather than blending into the rest of the UI chrome.
  const searchOptions = {
    caseSensitive: false,
    decorations: {
      matchBackground: "#fbbf2433",
      matchBorder: "#fbbf2499",
      matchOverviewRuler: "#fbbf24",
      activeMatchBackground: "#fbbf24",
      activeMatchBorder: "#fde68a",
      activeMatchColorOverviewRuler: "#fde68a"
    }
  } as const;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const handle = searchAddon.onDidChangeResults((event) => {
      setResults({ resultIndex: event.resultIndex, resultCount: event.resultCount });
    });
    return () => handle.dispose();
  }, [searchAddon]);

  // When the bar unmounts (pane lost focus + closed, Esc, X), clear the
  // decorations so stale highlights don't linger on the terminal.
  useEffect(() => {
    return () => {
      searchAddon.clearDecorations();
    };
  }, [searchAddon]);

  // Live-search as the user types — incremental mode keeps the current match
  // anchored where possible so the result doesn't jump on every keystroke.
  useEffect(() => {
    if (!query) {
      searchAddon.clearDecorations();
      setResults({ resultIndex: -1, resultCount: 0 });
      return;
    }
    searchAddon.findNext(query, { ...searchOptions, incremental: true });
    // searchOptions is a literal const above — stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchAddon]);

  const findNext = useCallback(() => {
    if (query) searchAddon.findNext(query, searchOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchAddon]);
  const findPrev = useCallback(() => {
    if (query) searchAddon.findPrevious(query, searchOptions);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchAddon]);

  const counter =
    results.resultCount === 0
      ? query
        ? "0/0"
        : ""
      : `${results.resultIndex + 1}/${results.resultCount}`;

  return (
    <div
      className="absolute right-3 top-3 z-10 flex items-center gap-1 rounded-md border border-white/10 bg-[#15181d]/95 px-2 py-1 shadow-lg backdrop-blur"
      onMouseDown={(event) => {
        // Keep clicks inside the bar from focusing the underlying pane
        // (which would steal focus back into xterm).
        event.stopPropagation();
      }}
    >
      <SearchIcon className="size-3.5 text-zinc-500" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
            return;
          }
          if (event.key === "Enter") {
            event.preventDefault();
            event.stopPropagation();
            if (event.shiftKey) findPrev();
            else findNext();
          }
        }}
        placeholder="Find in pane…"
        className="w-44 bg-transparent text-xs text-zinc-100 outline-none placeholder:text-zinc-500"
        aria-label="Find in pane"
      />
      <span className="min-w-[3.5rem] text-right font-mono text-[11px] text-zinc-500">
        {counter}
      </span>
      <Tooltip label="Previous (Shift+Enter)">
        <button
          type="button"
          onClick={findPrev}
          disabled={!query || results.resultCount === 0}
          aria-label="Previous match"
          className="rounded p-1 text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-30"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden="true">
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip label="Next (Enter)">
        <button
          type="button"
          onClick={findNext}
          disabled={!query || results.resultCount === 0}
          aria-label="Next match"
          className="rounded p-1 text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-30"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </Tooltip>
      <Tooltip label="Close (Esc)">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="rounded p-1 text-zinc-500 transition hover:bg-white/10 hover:text-zinc-200"
        >
          <CloseIcon className="size-3" />
        </button>
      </Tooltip>
    </div>
  );
}

type PaneIconButtonProps = {
  label: string;
  accent: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
};

/**
 * Compact icon button for a pane header. Stops click propagation so it doesn't
 * read as a generic pane click — but mousedown still bubbles, so acting on a
 * pane's control also focuses that pane, which is the behaviour we want.
 */
function PaneIconButton({ label, accent, disabled, onClick, children }: PaneIconButtonProps) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        aria-label={label}
        className={`rounded p-1 transition disabled:pointer-events-none disabled:opacity-30 ${accent}`}
      >
        {children}
      </button>
    </Tooltip>
  );
}
