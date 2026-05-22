import { Fragment, useEffect, useRef } from "react";
import type { MutableRefObject, ReactNode } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { Group, Panel, Separator } from "react-resizable-panels";
import type { ServiceConfig, ServiceStatus } from "./types";
import { formatCommand } from "./types";
import { ClearIcon, CloseIcon, PlayIcon, RestartIcon, StopIcon } from "./icons";
import { Tooltip } from "./Tooltip";

const statusDots: Record<ServiceStatus, string> = {
  stopped: "bg-zinc-600",
  starting: "bg-amber-400",
  running: "bg-cyan-400",
  stopping: "bg-orange-400",
  exited: "bg-sky-400",
  failed: "bg-rose-400"
};

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
  statuses: Record<string, ServiceStatus>;
  /** Live PIDs, keyed by service id — a present pid means the process runs. */
  pids: Record<string, number>;
  /** App-owned registry so log streaming can reach each pane's terminal. */
  terminalsRef: MutableRefObject<Map<string, Terminal>>;
  /** App-owned per-service log ring buffers, replayed when a pane mounts. */
  logsRef: MutableRefObject<Record<string, string[]>>;
  onFocus: (serviceId: string) => void;
  onClose: (serviceId: string) => void;
  onStart: (service: ServiceConfig) => void;
  onStop: (service: ServiceConfig) => void;
  onClear: (serviceId: string) => void;
};

export function TerminalPanes({
  paneServices,
  focusedId,
  statuses,
  pids,
  terminalsRef,
  logsRef,
  onFocus,
  onClose,
  onStart,
  onStop,
  onClear
}: TerminalPanesProps) {
  if (paneServices.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-zinc-500">
        No service open.
      </div>
    );
  }

  return (
    <Group orientation="horizontal" className="min-h-0 flex-1">
      {paneServices.map((service, index) => (
        <Fragment key={service.id}>
          {index > 0 ? (
            <Separator className="group/sep relative w-1.5 cursor-col-resize bg-transparent">
              <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-white/10 transition-colors group-hover/sep:bg-cyan-500/50" />
            </Separator>
          ) : null}
          {/* react-resizable-panels forces `overflow: auto` inline on the
              panel's inner div, which makes it a scroll container. The library
              spreads the `style` prop *after* its own overflow, so this is the
              intended way to override it — the pane must clip, not scroll;
              xterm owns its own scrolling. */}
          <Panel
            minSize="15%"
            className="flex min-h-0 flex-col overflow-hidden"
            style={{ overflow: "hidden" }}
          >
            <PaneView
              service={service}
              status={statuses[service.id] ?? "stopped"}
              running={pids[service.id] != null}
              focused={service.id === focusedId}
              showClose={paneServices.length > 1}
              terminalsRef={terminalsRef}
              logsRef={logsRef}
              onFocus={() => onFocus(service.id)}
              onClose={() => onClose(service.id)}
              onStart={() => onStart(service)}
              onStop={() => onStop(service)}
              onClear={() => onClear(service.id)}
            />
          </Panel>
        </Fragment>
      ))}
    </Group>
  );
}

type PaneViewProps = {
  service: ServiceConfig;
  status: ServiceStatus;
  /** True while the process has a live PID — gates the Stop button. */
  running: boolean;
  focused: boolean;
  showClose: boolean;
  terminalsRef: MutableRefObject<Map<string, Terminal>>;
  logsRef: MutableRefObject<Record<string, string[]>>;
  onFocus: () => void;
  onClose: () => void;
  onStart: () => void;
  onStop: () => void;
  onClear: () => void;
};

function PaneView({
  service,
  status,
  running,
  focused,
  showClose,
  terminalsRef,
  logsRef,
  onFocus,
  onClose,
  onStart,
  onStop,
  onClear
}: PaneViewProps) {
  // `wrapRef` is the flex-sized box the ResizeObserver watches. `hostRef` is a
  // plain child that xterm renders into. Keeping them separate is what stops
  // the flicker: if the observer watched the same element xterm draws into,
  // `fit()` would perturb that element's box and re-trigger the observer in a
  // self-sustaining loop.
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  // One terminal per pane, created once. The pane is keyed by service id in the
  // parent, so this component instance maps 1:1 to a service for its lifetime.
  useEffect(() => {
    const wrap = wrapRef.current;
    const host = hostRef.current;
    if (!wrap || !host) {
      return;
    }

    const terminal = new Terminal(TERMINAL_OPTIONS);
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    let resizeObserver: ResizeObserver | null = null;
    let disposed = false;
    let setupRaf = 0;
    let fitRaf = 0;

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

    // Defer open/fit/write to the next frame. A pane's mount effect runs
    // *before* react-resizable-panels' parent effect has applied the final
    // panel widths — fitting and writing here would size the terminal wrong
    // and the replayed log would render garbled. By the next frame the layout
    // has settled.
    setupRaf = requestAnimationFrame(() => {
      if (disposed) {
        return;
      }
      terminal.open(host);
      safeFit();

      terminal.writeln(`\x1b[1;38;2;34;211;238m${service.name}\x1b[0m`);
      terminal.writeln(`cwd: ${service.cwd}`);
      terminal.writeln(`cmd: ${formatCommand(service)}`);
      terminal.writeln("");
      for (const chunk of logsRef.current[service.id] ?? []) {
        terminal.write(chunk);
      }

      // Register only after the replay, so live output appends in order.
      terminalsRef.current.set(service.id, terminal);

      // Debounce fits to one per frame — extra insurance against rapid
      // resize bursts (e.g. while dragging a pane divider).
      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(fitRaf);
        fitRaf = requestAnimationFrame(safeFit);
      });
      resizeObserver.observe(wrap);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(setupRaf);
      cancelAnimationFrame(fitRaf);
      resizeObserver?.disconnect();
      terminalsRef.current.delete(service.id);
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
          <span className={`size-2 rounded-full ${statusDots[status]}`} />
          <span
            className={`truncate text-xs font-medium ${
              focused ? "text-zinc-100" : "text-zinc-400"
            }`}
          >
            {service.name}
          </span>
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
                label={`Close ${service.name} pane`}
                accent="text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
                onClick={onClose}
              >
                <CloseIcon className="size-3.5" />
              </PaneIconButton>
            </>
          ) : null}
        </span>
      </div>
      <div ref={wrapRef} className="min-h-0 flex-1 overflow-hidden p-3">
        <div ref={hostRef} className="h-full w-full overflow-hidden" />
      </div>
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
