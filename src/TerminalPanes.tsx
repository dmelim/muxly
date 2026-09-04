import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MutableRefObject, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import type { ServiceConfig, ServiceStatus, WorkspacePanel } from "./types";
import type { StartHealth } from "./appTypes";
import { displayServiceName, formatCommand, redactSensitive } from "./types";
import { groupKey, statusLabels } from "./appUtils";
import { ClearIcon, CloseIcon, PlayIcon, RestartIcon, SearchIcon, StopIcon } from "./icons";
import { Tooltip } from "./Tooltip";
import type { MuxlyTheme } from "./theme";
import { xtermTheme } from "./theme";

const statusDots: Record<ServiceStatus, string> = {
  stopped: "bg-zinc-600",
  starting: "bg-amber-400",
  restarting: "bg-amber-400 animate-pulse",
  running: "bg-[var(--muxly-status-running)]",
  stopping: "bg-orange-400",
  exited: "bg-sky-400",
  failed: "bg-rose-400"
};

// Mirrors the shortcut label used in App.tsx — `Ctrl` on Linux/Windows, `⌘` on
// macOS — so the close-pane tooltip reads naturally on whichever platform.
const MOD_KEY = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl";

const TERMINAL_OPTIONS = {
  // The in-pane SearchAddon draws match highlights with registerDecoration /
  // registerMarker, which xterm classifies as proposed API and refuses to run
  // unless this is set — without it, every keystroke in search throws.
  allowProposedApi: true,
  convertEol: true,
  cursorBlink: true,
  fontFamily: "JetBrains Mono, Cascadia Mono, Consolas, monospace",
  fontSize: 13,
  lineHeight: 1.45,
  scrollback: 5000
} as const;

type TerminalPanesProps = {
  /** Services shown as panes, left-to-right. */
  paneServices: ServiceConfig[];
  /** The focused pane's service id — drives the toolbar/inspector. */
  focusedId: string | null;
  /** When true, sensitive services show a masked name (stream mode). */
  streamMode: boolean;
  /** Project group name → stable alias, used to redact sensitive paths in the
   * pane banner and replayed scrollback while stream mode is on. */
  projectNameAliases: Record<string, string>;
  statuses: Record<string, ServiceStatus>;
  /** Live PIDs, keyed by service id — a present pid means the process runs. */
  pids: Record<string, number>;
  /** Max columns before the pane grid wraps to a new row. */
  gridColumns: number;
  tabMode: boolean;
  panels: WorkspacePanel[];
  onTabFocus: (panelId: string, serviceId: string) => void;
  onTabMove: (serviceId: string, targetPanelId: string, targetIndex: number) => void;
  theme: MuxlyTheme;
  /** Per-service flag: a PTY run has started but not yet produced real output.
   * Drives the in-pane "waiting for output…" affordance. */
  awaitingOutput: Record<string, boolean>;
  /** Per-service start health for a run that hasn't produced output yet:
   * `waiting-port` (server, informational), `retrying`/`stuck` (portless). */
  startHealth: Record<string, StartHealth>;
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
  onFocus: (panelId: string, serviceId: string) => void;
  onClose: (panelId: string, serviceId: string) => void;
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
  projectNameAliases,
  statuses,
  pids,
  gridColumns,
  tabMode,
  panels,
  awaitingOutput,
  startHealth,
  terminalsRef,
  logsRef,
  searchPaneId,
  searchSeed,
  flashServiceId,
  flashNonce,
  portBlockers,
  adoptedPids,
  onFocus,
  onTabFocus,
  onTabMove,
  theme,
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
  const panelHostsRef = useRef(new Map<string, HTMLDivElement>());
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [draggedTabSourcePanelId, setDraggedTabSourcePanelId] = useState<string | null>(null);
  const draggedTabIdRef = useRef<string | null>(null);
  const [tabDropTarget, setTabDropTarget] = useState<{ panelId: string; index: number } | null>(null);
  const showTabDropTarget = useCallback((panelId: string, index: number) => {
    if (!draggedTabIdRef.current) return;
    setTabDropTarget((current) =>
      current?.panelId === panelId && current.index === index ? current : { panelId, index }
    );
  }, []);

  const finishTabDrag = useCallback(() => {
    draggedTabIdRef.current = null;
    setDraggedTabId(null);
    setDraggedTabSourcePanelId(null);
    setTabDropTarget(null);
  }, []);

  const dropTab = useCallback((panelId: string, index: number) => {
    const serviceId = draggedTabIdRef.current;
    if (serviceId) onTabMove(serviceId, panelId, index);
    finishTabDrag();
  }, [finishTabDrag, onTabMove]);

  useEffect(() => {
    const nextTheme = xtermTheme(theme);
    for (const terminal of terminalsRef.current.values()) {
      terminal.options.theme = nextTheme;
    }
  }, [terminalsRef, theme]);

  if (paneServices.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-zinc-500">
        No service open.
      </div>
    );
  }

  // The grid is column-capped, not column-fixed: with fewer panels than the
  // cap we use one column per pane so each one stays as wide as possible
  // instead of leaving empty cells. Past the cap we wrap to a new row.
  const cols = Math.max(1, Math.min(gridColumns, panels.length));
  const serviceById = new Map(paneServices.map((service) => [service.id, service]));
  const draggedService = draggedTabId ? serviceById.get(draggedTabId) : null;
  const renderTabDropPlaceholder = (panelId: string, index: number) => {
    if (
      !draggedService ||
      draggedTabSourcePanelId === panelId ||
      tabDropTarget?.panelId !== panelId ||
      tabDropTarget.index !== index
    ) {
      return null;
    }
    return (
      <div
        key={`tab-drop-${panelId}-${index}`}
        aria-hidden="true"
        onDragOver={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = "move";
          showTabDropTarget(panelId, index);
        }}
        onDrop={(event) => {
          event.preventDefault();
          event.stopPropagation();
          dropTab(panelId, index);
        }}
        className="flex min-w-0 items-center gap-1 rounded-t-md border border-b-0 border-white/15 bg-white/5 px-2 py-1 text-xs text-zinc-500 opacity-85"
      >
        <span className="flex min-w-0 max-w-48 items-center gap-1.5 truncate">
          <span className="size-1.5 shrink-0 rounded-full bg-zinc-600" />
          <span className="truncate">{displayServiceName(draggedService, streamMode)}</span>
        </span>
        <span className="rounded p-0.5 text-zinc-600">
          <CloseIcon className="size-3" />
        </span>
      </div>
    );
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        className={`grid h-full min-h-0 gap-1.5 p-1.5 `}
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridAutoRows: "minmax(0, 1fr)"
        }}
      >
      {panels.map((panel) => (
        <section
          key={panel.id}
          aria-label="Terminal panel"
          className="flex min-h-0 min-w-0 flex-col overflow-hidden"
        >
          {tabMode ? (
            <div
              role="tablist"
              aria-label="Panel tabs"
              onDragOver={(event) => {
                if (!draggedTabIdRef.current) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                showTabDropTarget(panel.id, panel.tabIds.length);
              }}
              onDrop={(event) => {
                if (!draggedTabIdRef.current) return;
                event.preventDefault();
                dropTab(panel.id, panel.tabIds.length);
              }}
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-white/10 px-1.5 pt-1.5"
            >
              {panel.tabIds.map((serviceId, tabIndex) => {
                const service = serviceById.get(serviceId);
                if (!service) return null;
                return (
                  <Fragment key={service.id}>
                    {renderTabDropPlaceholder(panel.id, tabIndex)}
                    <div
                      role="presentation"
                      className={`relative flex min-w-0 items-center gap-1 rounded-t-md border border-b-0 px-2 text-xs ${
                        service.id === panel.activeTabId
                          ? "border-white/15 bg-white/10 text-zinc-100"
                          : "border-transparent text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                      } ${draggedTabId === service.id ? "opacity-50" : ""}`}
                    >
                      <button
                        type="button"
                        role="tab"
                        draggable
                        aria-selected={service.id === panel.activeTabId}
                        aria-label={`${displayServiceName(service, streamMode)}, ${statusLabels[statuses[service.id] ?? "stopped"]}`}
                        onClick={() => onTabFocus(panel.id, service.id)}
                        onDragStart={(event) => {
                          draggedTabIdRef.current = service.id;
                          setDraggedTabId(service.id);
                          setDraggedTabSourcePanelId(panel.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", service.id);
                        }}
                        onDragOver={(event) => {
                          if (!draggedTabIdRef.current) return;
                          event.preventDefault();
                          event.stopPropagation();
                          event.dataTransfer.dropEffect = "move";
                          const bounds = event.currentTarget.getBoundingClientRect();
                          const index = event.clientX < bounds.left + bounds.width / 2
                            ? tabIndex
                            : tabIndex + 1;
                          showTabDropTarget(panel.id, index);
                        }}
                        onDrop={(event) => {
                          if (!draggedTabIdRef.current) return;
                          event.preventDefault();
                          event.stopPropagation();
                          const bounds = event.currentTarget.getBoundingClientRect();
                          const index = event.clientX < bounds.left + bounds.width / 2
                            ? tabIndex
                            : tabIndex + 1;
                          dropTab(panel.id, index);
                        }}
                        onDragEnd={finishTabDrag}
                        className="flex min-w-0 max-w-48 self-stretch cursor-grab items-center gap-1.5 truncate py-1 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
                      >
                        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${statusDots[statuses[service.id] ?? "stopped"]}`} />
                        <span className="truncate">{displayServiceName(service, streamMode)}</span>
                        <span className="sr-only">{statusLabels[statuses[service.id] ?? "stopped"]}</span>
                      </button>
                      <button type="button" onClick={() => onClose(panel.id, service.id)} aria-label={`Close ${displayServiceName(service, streamMode)} tab`} className="rounded p-0.5 text-zinc-500 hover:bg-white/10 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40">
                        <CloseIcon className="size-3" />
                      </button>
                    </div>
                  </Fragment>
                );
              })}
              {renderTabDropPlaceholder(panel.id, panel.tabIds.length)}
            </div>
          ) : null}
          <div
            ref={(host) => {
              if (host) panelHostsRef.current.set(panel.id, host);
              else panelHostsRef.current.delete(panel.id);
            }}
            className="relative min-h-0 flex-1"
          />
        </section>
      ))}
      </div>
      {paneServices.map((service) => {
        const panel = panels.find((candidate) => candidate.tabIds.includes(service.id));
        if (!panel) return null;
        const seed = searchSeed && searchSeed.serviceId === service.id ? searchSeed : null;
        const flashing = flashServiceId === service.id;
        return (
          <StablePane
            key={service.id}
            panelId={panel.id}
            panelHostsRef={panelHostsRef}
            active={service.id === panel.activeTabId}
          >
            <PaneShell flashing={flashing} flashNonce={flashNonce}>
              <PaneView
                service={service}
                streamMode={streamMode}
                alias={projectNameAliases[groupKey(service)] ?? ""}
                status={statuses[service.id] ?? "stopped"}
                running={pids[service.id] != null || adoptedPids[service.id] != null}
                awaitingOutput={awaitingOutput[service.id] ?? false}
                startHealth={startHealth[service.id] ?? null}
                focused={service.id === focusedId}
                showIdentity={!tabMode}
                showClose={!tabMode && panels.length > 1}
                searchOpen={service.id === searchPaneId}
                searchSeed={seed}
                blocker={portBlockers[service.id] ?? null}
                adopted={adoptedPids[service.id] ?? null}
                terminalsRef={terminalsRef}
                logsRef={logsRef}
                theme={theme}
                onFocus={() => onFocus(panel.id, service.id)}
                onClose={() => onClose(panel.id, service.id)}
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
          </StablePane>
        );
      })}
    </div>
  );
}

// React owns each service at one stable position, independent of panel membership.
// Moving the portal's existing host preserves xterm, scrollback and search state.
function StablePane({ panelId, panelHostsRef, active, children }: {
  panelId: string;
  panelHostsRef: MutableRefObject<Map<string, HTMLDivElement>>;
  active: boolean;
  children: ReactNode;
}) {
  const [host] = useState(() => document.createElement("div"));
  useLayoutEffect(() => {
    const target = panelHostsRef.current.get(panelId);
    host.className = active ? "h-full" : "hidden";
    if (target && host.parentElement !== target) {
      const focused = host.contains(document.activeElement)
        ? document.activeElement as HTMLElement
        : null;
      target.appendChild(host);
      if (active) focused?.focus({ preventScroll: true });
    }
  });
  useLayoutEffect(() => () => host.remove(), [host]);
  return createPortal(children, host);
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
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
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

// Subtle, non-interactive affordance shown over a PTY pane after the process
// has started but before it has produced its first real output. Fills the
// otherwise-blank gap (which can stretch across a ConPTY recycle) so a slow or
// briefly-stuck start reads as "working" rather than hung. Pinned to the bottom
// so it never covers the start banner the terminal prints at the top.
function WaitingForOutput() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
      <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-[#15181d]/90 px-3 py-1 text-[11px] text-cyan-200/90 shadow-sm backdrop-blur">
        Waiting for output
        <span className="inline-flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="size-1.5 rounded-full bg-cyan-400 animate-pulse"
              style={{ animationDelay: `${i * 0.25}s` }}
            />
          ))}
        </span>
      </span>
    </div>
  );
}

// Notice for a run that started but hasn't produced output yet. Four honest
// flavours (see StartHealth):
//  - waiting-port: the service has a port; we are NOT killing it — just waiting
//    for that port to come up (the reliable "started" signal). Calm/amber.
//  - quiet: a portless start produced no output and nothing is being done about
//    it (everywhere except Windows). Purely informational; calm/amber.
//  - retrying: a portless start produced no output; the watchdog is recycling.
//  - stuck: a portless start gave up and needs user attention; rose.
// Pinned to the bottom so it doesn't cover the start banner.
function StartHealthNotice({ startHealth }: { startHealth: StartHealth }) {
  const stuck = startHealth.kind === "stuck";
  const tone = stuck
    ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
    : "border-amber-500/30 bg-amber-500/10 text-amber-100";
  const dot = stuck ? "bg-rose-400" : "bg-amber-400";

  const message =
    startHealth.kind === "waiting-port"
      ? startHealth.port != null
        ? `Starting — waiting for port ${startHealth.port} to come up…`
        : "Starting — waiting for the server to come up…"
      : startHealth.kind === "quiet"
      ? "Running — no output yet."
      : startHealth.kind === "retrying"
      ? `No output yet — retrying (${startHealth.attempt}/${startHealth.max})…`
      : `No output after ${startHealth.max} tries — start may be stuck. Stop and start again to retry.`;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3">
      <span
        className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-[11px] shadow-sm backdrop-blur ${tone}`}
      >
        <span className={`size-1.5 shrink-0 rounded-full ${dot} ${stuck ? "" : "animate-pulse"}`} />
        <span className="truncate">{message}</span>
      </span>
    </div>
  );
}

type PaneViewProps = {
  service: ServiceConfig;
  /** When true and the service is sensitive, its name is masked in the header. */
  streamMode: boolean;
  /** Stable alias for this service's project group — substituted for sensitive
   * paths in the banner and replayed scrollback while stream mode is on. */
  alias: string;
  status: ServiceStatus;
  /** True while the process has a live PID — gates the Stop button. */
  running: boolean;
  /** True for a PTY run that has started but not yet emitted real output. */
  awaitingOutput: boolean;
  /** Start health for a not-yet-producing run, or null when healthy. */
  startHealth: StartHealth | null;
  focused: boolean;
  showIdentity: boolean;
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
  theme: MuxlyTheme;
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
  alias,
  status,
  running,
  awaitingOutput,
  startHealth,
  focused,
  showIdentity,
  showClose,
  searchOpen,
  searchSeed,
  blocker,
  adopted,
  terminalsRef,
  logsRef,
  theme,
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
  // Same one-shot-effect concern for the alias used to redact sensitive paths
  // in the banner and replayed scrollback.
  const aliasRef = useRef(alias);
  aliasRef.current = alias;

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
    const terminal = new Terminal({
      ...TERMINAL_OPTIONS,
      convertEol: !isPty,
      theme: xtermTheme(theme)
    });
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

      // Redact sensitive paths in the banner and replayed scrollback the same
      // way the live stream does (App.appendLog). Reads the refs so a pane
      // opened while stream mode is on starts masked.
      const redact = (text: string) =>
        redactSensitive(text, service, aliasRef.current, streamModeRef.current);

      terminal.writeln(
        `\x1b[1;36m${displayServiceName(service, streamModeRef.current)}\x1b[0m`
      );
      terminal.writeln(redact(`cwd: ${service.cwd}`));
      terminal.writeln(redact(`cmd: ${formatCommand(service)}`));
      terminal.writeln("");
      for (const chunk of logsRef.current[service.id] ?? []) {
        terminal.write(redact(chunk));
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
      className={`flex min-h-0 flex-1 flex-col ring-1 ring-inset ${
        focused ? "ring-cyan-500/30" : "ring-[var(--muxly-border)]"
      }`}
    >
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-white/10 pl-3 pr-1.5">
        {showIdentity ? <span className="flex min-w-0 items-center gap-2">
          {/* Adopted services show a cyan dot regardless of the underlying
              ServiceStatus, since the foreign process is what's actually
              listening on the port right now. */}
          <span
            className={`size-2 rounded-full ${
              adopted ? statusDots.running : statusDots[status]
            } ${status === "stopping" ? "animate-pulse" : ""}`}
          />
          <span
            className={`truncate text-xs font-medium ${
              focused ? "text-zinc-100" : "text-zinc-400"
            }`}
          >
            {displayServiceName(service, streamMode)}
          </span>
          {status === "stopping" ? (
            <span className="flex shrink-0 items-center gap-1 rounded-full border border-orange-500/40 bg-orange-500/10 px-2 py-0.5 text-[10px] font-medium text-orange-200">
              <span className="size-2 animate-spin rounded-full border border-orange-300/40 border-t-orange-300" />
              <span>Stopping…</span>
            </span>
          ) : null}
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
        </span> : <span />}
        <span className="flex shrink-0 items-center gap-0.5">
          {running ? (
            <PaneIconButton
              label={status === "stopping" ? "Stopping…" : "Stop"}
              accent="text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
              disabled={status === "stopping"}
              onClick={onStop}
            >
              <StopIcon className="size-3.5" />
            </PaneIconButton>
          ) : status === "failed" || status === "exited" ? (
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
              disabled={status === "running" || status === "starting" || status === "restarting"}
              onClick={onStart}
            >
              <PlayIcon className="size-3.5" />
            </PaneIconButton>
          )}
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
        {startHealth ? (
          <StartHealthNotice startHealth={startHealth} />
        ) : awaitingOutput ? (
          <WaitingForOutput />
        ) : null}
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

  // Same guard rationale as the find calls below: clearing decorations also
  // touches the renderer/decoration path, so contain + log any throw rather
  // than letting it bubble out of an effect and blank the app.
  const safeClearDecorations = useCallback(() => {
    try {
      searchAddon.clearDecorations();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[search] clearDecorations threw", error);
    }
  }, [searchAddon]);

  // When the bar unmounts (pane lost focus + closed, Esc, X), clear the
  // decorations so stale highlights don't linger on the terminal.
  useEffect(() => {
    return () => {
      safeClearDecorations();
    };
  }, [safeClearDecorations]);

  // Live-search as the user types — incremental mode keeps the current match
  // anchored where possible so the result doesn't jump on every keystroke.
  useEffect(() => {
    if (!query) {
      safeClearDecorations();
      setResults({ resultIndex: -1, resultCount: 0 });
      return;
    }
    // Guarded: a throw from the addon here runs inside an effect, which in
    // React 19 would unmount the whole tree (blank window) since there's no
    // boundary below the root. Contain + log it instead, so a bad search
    // degrades to "no results" rather than taking down the UI.
    try {
      searchAddon.findNext(query, { ...searchOptions, incremental: true });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[search] findNext (incremental) threw for query", JSON.stringify(query), error);
    }
    // searchOptions is a literal const above — stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchAddon]);

  const findNext = useCallback(() => {
    if (!query) return;
    try {
      searchAddon.findNext(query, searchOptions);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[search] findNext threw for query", JSON.stringify(query), error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchAddon]);
  const findPrev = useCallback(() => {
    if (!query) return;
    try {
      searchAddon.findPrevious(query, searchOptions);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("[search] findPrevious threw for query", JSON.stringify(query), error);
    }
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
