import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import type {
  ProcessExitedEvent,
  ProcessFailedEvent,
  ProcessOutputEvent,
  ProcessStartedEvent,
  ServiceConfig,
  ServiceHistory,
  ServiceStatus
} from "./types";
import { PROCESS_EXITED, PROCESS_FAILED, PROCESS_STARTED, SERVICES_CHANGED } from "./events";
import { formatCommand } from "./types";
import { ServiceForm } from "./ServiceForm";
import { ImportPanel } from "./ImportPanel";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";
import { GlobalSearch } from "./GlobalSearch";
import { TerminalPanes } from "./TerminalPanes";
import {
  PanelLeftIcon,
  PanelRightIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SplitIcon,
  StopIcon
} from "./icons";

type EditTarget =
  | { mode: "edit"; service: ServiceConfig }
  | { mode: "new" }
  | { mode: "import" };

const MAX_LOG_CHUNKS = 5000;

// Auto-restart guardrails: at most AUTO_RESTART_MAX crashes within
// AUTO_RESTART_WINDOW_MS before we give up, with a short delay between tries.
const AUTO_RESTART_MAX = 3;
const AUTO_RESTART_WINDOW_MS = 60_000;
const AUTO_RESTART_DELAY_MS = 1_000;

// Shorthand shown in shortcut tooltips. macOS uses ⌘, everything else Ctrl.
const modKey = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl";

const statusLabels: Record<ServiceStatus, string> = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  exited: "Exited",
  failed: "Failed"
};

const statusDots: Record<ServiceStatus, string> = {
  stopped: "bg-zinc-600",
  starting: "bg-amber-400",
  running: "bg-emerald-400",
  stopping: "bg-orange-400",
  exited: "bg-sky-400",
  failed: "bg-rose-400"
};

export function App() {
  const [services, setServices] = useState<ServiceConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Services currently open as terminal panes, left-to-right.
  const [paneIds, setPaneIds] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ServiceStatus>>({});
  const [pids, setPids] = useState<Record<string, number>>({});
  const [lastExit, setLastExit] = useState<Record<string, string>>({});
  const [managerMessage, setManagerMessage] = useState("Loading service config...");
  // One xterm terminal per open pane, keyed by service id.
  const terminalsRef = useRef<Map<string, Terminal>>(new Map());
  const logsRef = useRef<Record<string, string[]>>({});
  const outputChannelsRef = useRef<Record<string, Channel<ProcessOutputEvent>>>({});
  // Kept in sync with `services` so closures captured by the long-lived event
  // listeners (which only mount once) always see the latest config.
  const servicesRef = useRef<ServiceConfig[]>([]);
  // Per-service auto-restart bookkeeping: how many times we've re-spawned and
  // when the last attempt happened, so we can enforce the retry cap/window.
  const autoRestartRef = useRef<Record<string, { count: number; lastAt: number }>>({});
  // Lets the once-mounted exit listener call the latest startService closure.
  const startServiceRef = useRef<(service: ServiceConfig) => Promise<void>>(async () => {});
  const [editing, setEditing] = useState<EditTarget | null>(null);
  // Map of serviceId → true when its configured port is held by another process.
  // Only meaningful when the service is not running — we never flag our own
  // listener as a "conflict".
  const [portConflicts, setPortConflicts] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<Record<string, ServiceHistory>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(340);

  // Open panes resolved to live ServiceConfigs (deleted services drop out).
  const paneServices = useMemo(
    () =>
      paneIds
        .map((id) => services.find((service) => service.id === id))
        .filter((service): service is ServiceConfig => service != null),
    [paneIds, services]
  );

  // The focused service drives the toolbar and inspector. Falls back to the
  // first open pane (e.g. after the focused pane is closed), then any service.
  const selected = useMemo(
    () =>
      services.find((service) => service.id === selectedId) ??
      paneServices[0] ??
      services[0] ??
      null,
    [selectedId, services, paneServices]
  );

  // Services in the same order the sidebar renders them (grouped), so the
  // Ctrl+1..9 shortcuts line up with what the user sees.
  const flatServices = useMemo(
    () => groupServices(services).flatMap(([, list]) => list),
    [services]
  );

  // Below this sidebar width, switch space-hungry controls to compact icons.
  const compactSidebar = leftWidth < 264;

  // Open a service as the sole pane (replaces the current layout).
  const openSingle = useCallback((serviceId: string) => {
    setPaneIds([serviceId]);
    setSelectedId(serviceId);
  }, []);

  // Open a service in an additional pane, or focus it if already open.
  const openInSplit = useCallback((serviceId: string) => {
    setPaneIds((current) =>
      current.includes(serviceId) ? current : [...current, serviceId]
    );
    setSelectedId(serviceId);
  }, []);

  const closePane = useCallback((serviceId: string) => {
    setPaneIds((current) => current.filter((id) => id !== serviceId));
    // Clearing focus lets `selected` fall back to the first remaining pane.
    setSelectedId((current) => (current === serviceId ? null : current));
  }, []);

  useEffect(() => {
    servicesRef.current = services;
  }, [services]);

  // Run-history is non-critical; a failed fetch is silently ignored.
  const refreshHistory = useCallback((serviceId: string) => {
    invoke<ServiceHistory>("get_service_history", { serviceId })
      .then((result) => setHistory((current) => ({ ...current, [serviceId]: result })))
      .catch(() => {
        /* history unavailable — leave previous value */
      });
  }, []);

  useEffect(() => {
    if (selected) {
      refreshHistory(selected.id);
    }
  }, [selected?.id, refreshHistory]);

  // Probe each service's port (if set) and update the conflict map.
  // Runs in parallel; failures are treated as "no conflict" so a dead probe
  // doesn't permanently disable a service in the UI.
  const scanPorts = useCallback(async (servicesToScan: ServiceConfig[]) => {
    const probes = await Promise.all(
      servicesToScan
        .filter((service) => service.port != null)
        .map(async (service) => {
          try {
            const available = await invoke<boolean>("check_port", { port: service.port });
            return [service.id, !available] as const;
          } catch {
            return [service.id, false] as const;
          }
        })
    );
    setPortConflicts((current) => {
      const next = { ...current };
      for (const [id, conflict] of probes) next[id] = conflict;
      return next;
    });
  }, []);

  const reloadServices = useCallback(async () => {
    try {
      const loaded = await invoke<ServiceConfig[]>("load_services");
      setServices(loaded);
      setStatuses((current) => {
        const next: Record<string, ServiceStatus> = {};
        for (const service of loaded) {
          next[service.id] = current[service.id] ?? "stopped";
        }
        return next;
      });
      setManagerMessage(
        loaded.length > 0 ? `Loaded ${loaded.length} services` : "No services configured yet"
      );
      return loaded;
    } catch (error) {
      setManagerMessage(errorMessage(error));
      throw error;
    }
  }, []);

  useEffect(() => {
    reloadServices()
      .then((loaded) => {
        const first = loaded[0]?.id ?? null;
        setSelectedId((current) => current ?? first);
        setPaneIds((current) =>
          current.length > 0 ? current : first ? [first] : []
        );
        void scanPorts(loaded);
      })
      .catch(() => {
        /* error already surfaced in managerMessage */
      });
  }, [reloadServices, scanPorts]);

  // External edits to services.json (agent, script, editor) reload live.
  useEffect(() => {
    const unlisten = listen(SERVICES_CHANGED, () => {
      reloadServices()
        .then((loaded) => void scanPorts(loaded))
        .catch(() => {
          /* error already surfaced in managerMessage */
        });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [reloadServices, scanPorts]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    listen<ProcessStartedEvent>(PROCESS_STARTED, (event) => {
      const { serviceId, pid } = event.payload;
      setStatuses((current) => ({ ...current, [serviceId]: "running" }));
      setPids((current) => ({ ...current, [serviceId]: pid }));
      // The port (if any) now belongs to this service; clear any stale conflict.
      setPortConflicts((current) =>
        current[serviceId] ? { ...current, [serviceId]: false } : current
      );
      appendLog(serviceId, `\r\n\x1b[32m[manager] started pid ${pid}\x1b[0m\r\n`);
      refreshHistory(serviceId);
    }).then((unlisten) => unlisteners.push(unlisten));

    listen<ProcessExitedEvent>(PROCESS_EXITED, (event) => {
      const { serviceId, code, requested } = event.payload;
      delete outputChannelsRef.current[serviceId];
      const nextStatus: ServiceStatus = requested
        ? "stopped"
        : code === 0 || code === null
        ? "exited"
        : "failed";
      setStatuses((current) => ({ ...current, [serviceId]: nextStatus }));
      setPids((current) => {
        const next = { ...current };
        delete next[serviceId];
        return next;
      });
      setLastExit((current) => ({
        ...current,
        [serviceId]: requested ? "stopped" : code === null ? "signal" : `${code}`
      }));
      const description = requested
        ? "stopped by user"
        : code === null
        ? "signal"
        : `code ${code}`;
      appendLog(
        serviceId,
        `\r\n\x1b[36m[manager] process exited (${description})\x1b[0m\r\n`
      );
      // Re-probe the port after a short delay so the OS has time to release it.
      scheduleRescan(serviceId);

      refreshHistory(serviceId);

      if (nextStatus === "failed") {
        maybeAutoRestart(serviceId);
      } else {
        // Clean exit or user stop — reset the crash budget.
        delete autoRestartRef.current[serviceId];
      }
    }).then((unlisten) => unlisteners.push(unlisten));

    listen<ProcessFailedEvent>(PROCESS_FAILED, (event) => {
      const { serviceId, message } = event.payload;
      delete outputChannelsRef.current[serviceId];
      setStatuses((current) => ({ ...current, [serviceId]: "failed" }));
      appendLog(serviceId, `\r\n\x1b[31m[manager] ${message}\x1b[0m\r\n`);
      scheduleRescan(serviceId);
      refreshHistory(serviceId);
    }).then((unlisten) => unlisteners.push(unlisten));

    function scheduleRescan(serviceId: string) {
      const service = servicesRef.current.find((s) => s.id === serviceId);
      if (!service || service.port == null) return;
      window.setTimeout(() => void scanPorts([service]), 300);
    }

    function maybeAutoRestart(serviceId: string) {
      const service = servicesRef.current.find((s) => s.id === serviceId);
      if (!service || !service.autoRestart) return;

      const now = Date.now();
      const record = autoRestartRef.current[serviceId] ?? { count: 0, lastAt: 0 };
      // A quiet period resets the budget — a service that ran fine for a while
      // and then crashed gets a fresh set of retries.
      if (now - record.lastAt > AUTO_RESTART_WINDOW_MS) {
        record.count = 0;
      }

      if (record.count >= AUTO_RESTART_MAX) {
        appendLog(
          serviceId,
          `\r\n\x1b[31m[manager] auto-restart gave up after ${AUTO_RESTART_MAX} attempts\x1b[0m\r\n`
        );
        return;
      }

      record.count += 1;
      record.lastAt = now;
      autoRestartRef.current[serviceId] = record;
      appendLog(
        serviceId,
        `\r\n\x1b[33m[manager] auto-restarting (attempt ${record.count}/${AUTO_RESTART_MAX})\x1b[0m\r\n`
      );
      window.setTimeout(() => {
        void startServiceRef.current(service);
      }, AUTO_RESTART_DELAY_MS);
    }

    return () => {
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const appendLog = useCallback((serviceId: string, chunk: string) => {
    const chunks = logsRef.current[serviceId] ?? [];
    chunks.push(chunk);

    if (chunks.length > MAX_LOG_CHUNKS) {
      chunks.splice(0, chunks.length - MAX_LOG_CHUNKS);
    }

    logsRef.current[serviceId] = chunks;
    // Write live to the pane showing this service, if one is open.
    terminalsRef.current.get(serviceId)?.write(chunk);
  }, []);

  const startService = useCallback(
    async (service: ServiceConfig) => {
      const currentStatus = statuses[service.id];
      if (currentStatus === "running" || currentStatus === "starting") {
        return;
      }

      setStatuses((current) => ({ ...current, [service.id]: "starting" }));
      appendLog(
        service.id,
        `\r\n\x1b[36m[manager] starting ${formatCommand(service)}\x1b[0m\r\n`
      );

      const onOutput = new Channel<ProcessOutputEvent>();
      onOutput.onmessage = (msg) => {
        const { serviceId, stream, chunk } = msg;
        appendLog(serviceId, stream === "stderr" ? `\x1b[31m${chunk}\x1b[0m` : chunk);
      };
      outputChannelsRef.current[service.id] = onOutput;

      try {
        await invoke("start_service", { service, onOutput });
      } catch (error) {
        delete outputChannelsRef.current[service.id];
        setStatuses((current) => ({ ...current, [service.id]: "failed" }));
        appendLog(service.id, `\r\n\x1b[31m[manager] ${errorMessage(error)}\x1b[0m\r\n`);
      }
    },
    [appendLog, statuses]
  );

  useEffect(() => {
    startServiceRef.current = startService;
  }, [startService]);

  // A start triggered explicitly by the user. Clears the auto-restart budget so
  // a manual start after "gave up" gets a fresh set of retries.
  const manualStart = useCallback(
    (service: ServiceConfig) => {
      delete autoRestartRef.current[service.id];
      return startService(service);
    },
    [startService]
  );

  const stopService = useCallback(
    async (service: ServiceConfig) => {
      if (!pids[service.id]) {
        return;
      }

      setStatuses((current) => ({ ...current, [service.id]: "stopping" }));
      appendLog(service.id, `\r\n\x1b[36m[manager] stop requested\x1b[0m\r\n`);

      try {
        await invoke("stop_service", { serviceId: service.id });
      } catch (error) {
        setStatuses((current) => ({ ...current, [service.id]: "failed" }));
        appendLog(service.id, `\r\n\x1b[31m[manager] ${errorMessage(error)}\x1b[0m\r\n`);
      }
    },
    [appendLog, pids]
  );

  const startGroup = (groupName: string) => {
    services
      .filter((service) => groupKey(service) === groupName)
      .forEach((service) => {
        void manualStart(service);
      });
  };

  const saveServiceConfig = async (incoming: ServiceConfig) => {
    const editingId = editing?.mode === "edit" ? editing.service.id : null;
    const next = editingId
      ? services.map((service) => (service.id === editingId ? incoming : service))
      : [...services, incoming];

    await invoke("save_services", { services: next });
    const loaded = await reloadServices();
    setSelectedId(incoming.id);
    setEditing(null);
    void loaded;
  };

  const importServices = async (incoming: ServiceConfig[]) => {
    if (incoming.length === 0) return;
    const next = [...services, ...incoming];
    await invoke("save_services", { services: next });
    await reloadServices();
    setSelectedId(incoming[0].id);
    setEditing(null);
  };

  const deleteServiceConfig = async (target: ServiceConfig) => {
    if (pids[target.id]) {
      throw new Error("Stop the service before deleting it");
    }
    const next = services.filter((service) => service.id !== target.id);
    await invoke("save_services", { services: next });
    await reloadServices();
    setSelectedId(next[0]?.id ?? null);
    setEditing(null);
  };

  const stopGroup = (groupName: string) => {
    services
      .filter((service) => groupKey(service) === groupName)
      .forEach((service) => {
        void stopService(service);
      });
  };

  // Drag-resize a sidebar. Listens on window so the drag continues even when
  // the pointer leaves the thin handle.
  const startSidebarDrag = useCallback(
    (side: "left" | "right", event: React.MouseEvent) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = side === "left" ? leftWidth : rightWidth;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";

      const onMove = (move: MouseEvent) => {
        const delta = move.clientX - startX;
        if (side === "left") {
          setLeftWidth(clamp(startWidth + delta, 220, 560));
        } else {
          // The right sidebar grows as the handle is dragged left.
          setRightWidth(clamp(startWidth - delta, 260, 600));
        }
      };
      const onUp = () => {
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [leftWidth, rightWidth]
  );

  // Drop one service's buffered log and wipe its terminal (if a pane is open).
  const clearLog = useCallback((serviceId: string) => {
    logsRef.current[serviceId] = [];
    terminalsRef.current.get(serviceId)?.clear();
  }, []);

  // The Ctrl+K shortcut clears whichever pane is focused.
  const clearSelectedLog = useCallback(() => {
    if (selected) clearLog(selected.id);
  }, [selected, clearLog]);

  // Global keyboard shortcuts. Modifier combos are ignored while the user is
  // typing in a form field; Escape always closes an open form.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        if (editing) {
          setEditing(null);
          return;
        }
      }

      const mod = event.ctrlKey || event.metaKey;
      if (!mod) {
        return;
      }

      // Ctrl/Cmd + Shift + F → global log search.
      if (event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }

      // Ctrl/Cmd + Shift + B → toggle the right sidebar.
      if (event.shiftKey && event.key.toLowerCase() === "b") {
        event.preventDefault();
        setRightSidebarOpen((open) => !open);
        return;
      }

      if (event.altKey || event.shiftKey) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTyping =
        target != null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (isTyping) {
        return;
      }

      // Ctrl/Cmd + 1..9 → open the Nth visible service as the sole pane.
      if (/^[1-9]$/.test(event.key)) {
        const service = flatServices[Number(event.key) - 1];
        if (service) {
          event.preventDefault();
          openSingle(service.id);
        }
        return;
      }

      switch (event.key.toLowerCase()) {
        case "r":
          if (selected) {
            event.preventDefault();
            void manualStart(selected);
          }
          break;
        case "s":
          if (selected) {
            event.preventDefault();
            void stopService(selected);
          }
          break;
        case "k":
          event.preventDefault();
          clearSelectedLog();
          break;
        case "n":
          event.preventDefault();
          setEditing({ mode: "new" });
          break;
        case "b":
          event.preventDefault();
          setLeftSidebarOpen((open) => !open);
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    editing,
    searchOpen,
    flatServices,
    selected,
    manualStart,
    stopService,
    clearSelectedLog,
    openSingle
  ]);

  return (
    <>
    <main
      className="relative grid h-screen grid-rows-1 overflow-hidden bg-[#101215] text-zinc-100"
      style={{
        gridTemplateColumns: `${leftSidebarOpen ? `${leftWidth}px` : "0"} 1fr ${
          rightSidebarOpen ? `${rightWidth}px` : "0"
        }`
      }}
    >
      <aside
        className={`flex min-h-0 flex-col overflow-hidden bg-[#15181d] ${
          leftSidebarOpen ? "border-r border-white/10" : ""
        }`}
      >
        <div className="border-b border-white/10 px-5 py-4">
          <p className="text-xs uppercase tracking-[0.18em] text-zinc-500">Workspace</p>
          <h1 className="mt-1 text-xl font-semibold tracking-normal">Muxly</h1>
          <p className="mt-2 line-clamp-2 text-xs text-zinc-500">{managerMessage}</p>
          <div className="mt-3 flex gap-2">
            {compactSidebar ? (
              <Tooltip label={`New service (${modKey}+N)`}>
                <Button
                  variant="dashed"
                  size="sm"
                  onClick={() => setEditing({ mode: "new" })}
                  aria-label="New service"
                >
                  <PlusIcon className="size-4" />
                </Button>
              </Tooltip>
            ) : (
              <Tooltip label={`New service (${modKey}+N)`} className="flex-1">
                <Button
                  variant="dashed"
                  size="sm"
                  onClick={() => setEditing({ mode: "new" })}
                  className="w-full"
                >
                  + New service
                </Button>
              </Tooltip>
            )}
            <Tooltip
              label="Import services from package.json or Procfile"
              className={compactSidebar ? "flex-1" : ""}
            >
              <Button
                variant="dashed"
                size="sm"
                onClick={() => setEditing({ mode: "import" })}
                className={compactSidebar ? "w-full" : ""}
              >
                Import
              </Button>
            </Tooltip>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden p-3">
          {groupServices(services).map(([groupName, groupServicesList]) => {
            const anyRunning = groupServicesList.some((service) => {
              const status = statuses[service.id];
              return status === "running" || status === "starting";
            });

            return (
              <div key={groupName} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 px-2 pt-1">
                  <h2 className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-500">
                    {groupName}
                  </h2>
                  <div className="flex shrink-0 gap-0.5">
                    <Tooltip label={`Start all in ${groupName}`}>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => startGroup(groupName)}
                        aria-label={`Start all services in ${groupName}`}
                      >
                        <PlayIcon className="size-3.5" />
                      </Button>
                    </Tooltip>
                    <Tooltip label={`Stop all in ${groupName}`}>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => stopGroup(groupName)}
                        disabled={!anyRunning}
                        aria-label={`Stop all running services in ${groupName}`}
                      >
                        <StopIcon className="size-3.5" />
                      </Button>
                    </Tooltip>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {groupServicesList.map((service) => {
                    const status = statuses[service.id] ?? "stopped";
                    const isOpen = paneIds.includes(service.id);
                    const showConflict =
                      service.port != null &&
                      portConflicts[service.id] &&
                      status !== "running" &&
                      status !== "starting" &&
                      status !== "stopping";

                    return (
                      <div
                        key={service.id}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          if (event.ctrlKey || event.metaKey || event.shiftKey) {
                            openInSplit(service.id);
                          } else {
                            openSingle(service.id);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openSingle(service.id);
                          }
                        }}
                        title={`Click to open · ${modKey}/Shift-click to open in split view`}
                        className={`group/card w-full cursor-pointer rounded-md border-l-2 px-3 py-3 text-left transition ${
                          selected?.id === service.id
                            ? "border-emerald-500 bg-white/10 text-white"
                            : isOpen
                            ? "border-emerald-500/40 text-zinc-300 hover:bg-white/5 hover:text-white"
                            : "border-transparent text-zinc-300 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-3">
                            <span className={`size-2.5 rounded-full ${statusDots[status]}`} />
                            <span className="truncate text-sm font-medium">{service.name}</span>
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5">
                            <Tooltip label="Open in split view">
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openInSplit(service.id);
                                }}
                                aria-label={`Open ${service.name} in split view`}
                                className="rounded p-1 text-zinc-500 opacity-0 transition hover:bg-white/10 hover:text-zinc-200 focus-visible:opacity-100 group-hover/card:opacity-100"
                              >
                                <SplitIcon className="size-3.5" />
                              </button>
                            </Tooltip>
                            <span className="text-xs text-zinc-500">{statusLabels[status]}</span>
                          </span>
                        </span>
                        <span className="mt-1 block truncate pl-5 font-mono text-xs text-zinc-500">
                          {formatCommand(service)}
                        </span>
                        {showConflict ? (
                          <span className="mt-1 block pl-5 text-[11px] text-amber-300">
                            ⚠ port {service.port} in use
                          </span>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <header className="flex h-16 items-center justify-between border-b border-white/10 px-5">
          <Tooltip label={`${leftSidebarOpen ? "Hide" : "Show"} services (${modKey}+B)`}>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLeftSidebarOpen((open) => !open)}
              aria-label="Toggle services sidebar"
            >
              <PanelLeftIcon className="size-4" />
            </Button>
          </Tooltip>
          <div className="flex items-center gap-2">
            <Tooltip label="Search all logs (Ctrl+Shift+F)">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSearchOpen(true)}
                aria-label="Search all logs"
              >
                <SearchIcon className="size-4" />
              </Button>
            </Tooltip>
            <span className="mx-1 h-5 w-px bg-white/10" />
            <Tooltip
              label={`${rightSidebarOpen ? "Hide" : "Show"} details (${modKey}+Shift+B)`}
              side="bottom"
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setRightSidebarOpen((open) => !open)}
                aria-label="Toggle details sidebar"
              >
                <PanelRightIcon className="size-4" />
              </Button>
            </Tooltip>
          </div>
        </header>

        <TerminalPanes
          paneServices={paneServices}
          focusedId={selected?.id ?? null}
          statuses={statuses}
          pids={pids}
          terminalsRef={terminalsRef}
          logsRef={logsRef}
          onFocus={setSelectedId}
          onClose={closePane}
          onStart={manualStart}
          onStop={stopService}
          onClear={clearLog}
        />
      </section>

      <aside
        className={`flex min-h-0 flex-col overflow-hidden bg-[#15181d] ${
          rightSidebarOpen ? "border-l border-white/10" : ""
        }`}
      >
        {editing?.mode === "import" ? (
          <ImportPanel
            existingIds={services.map((service) => service.id)}
            onImport={importServices}
            onCancel={() => setEditing(null)}
          />
        ) : editing ? (
          <ServiceForm
            initial={editing.mode === "edit" ? editing.service : null}
            existingIds={services
              .filter((service) => editing.mode !== "edit" || service.id !== editing.service.id)
              .map((service) => service.id)}
            onSave={saveServiceConfig}
            onCancel={() => setEditing(null)}
            onDelete={
              editing.mode === "edit"
                ? () => deleteServiceConfig(editing.service)
                : undefined
            }
          />
        ) : (
          <>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <h2 className="text-sm font-semibold">Details</h2>
          {selected ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setEditing({ mode: "edit", service: selected })}
            >
              Edit
            </Button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <div className="space-y-5 p-5 text-sm">
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openInEditor(selected.cwd, selected.id, appendLog)}
              >
                Open in VS Code
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => openInFileManager(selected.cwd, selected.id, appendLog)}
              >
                Open folder
              </Button>
              {selected.port ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => openServiceUrl(selected.port!, selected.id, appendLog)}
                >
                  Open localhost:{selected.port}
                </Button>
              ) : null}
            </div>
            <dl className="space-y-5">
              <Detail label="Status">{statusLabels[statuses[selected.id] ?? "stopped"]}</Detail>
              <Detail label="PID">{pids[selected.id] ?? "None"}</Detail>
              <Detail label="Last Exit">{lastExit[selected.id] ?? "None"}</Detail>
              <Detail label="Command">
                <span className="block rounded-md bg-black/20 p-3 font-mono text-xs text-zinc-300">
                  {formatCommand(selected)}
                </span>
              </Detail>
              <Detail label="Working Dir">
                <span className="font-mono text-xs text-zinc-300">{selected.cwd}</span>
              </Detail>
              <Detail label="Group">{selected.group ?? "None"}</Detail>
              <Detail label="Port">{selected.port ?? "None"}</Detail>
              <Detail label="Env">
                {Object.keys(selected.env).length === 0
                  ? "None"
                  : `${Object.keys(selected.env).length} variables`}
              </Detail>
            </dl>

            <div className="border-t border-white/10 pt-5">
              <p className="text-xs uppercase tracking-[0.14em] text-zinc-500">Run history</p>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                <Detail label="Total runs">{history[selected.id]?.totalRuns ?? 0}</Detail>
                <Detail label="Failed">{history[selected.id]?.failedRuns ?? 0}</Detail>
                <Detail label="Last run">{timeAgo(history[selected.id]?.lastStartedAt ?? null)}</Detail>
                <Detail label="Last failure">
                  {timeAgo(history[selected.id]?.lastFailureAt ?? null)}
                </Detail>
              </dl>
            </div>
          </div>
        ) : (
          <p className="p-5 text-sm text-zinc-500">No service selected. Use "+ New service" in the sidebar to create one.</p>
        )}
        </div>
          </>
        )}
      </aside>

      {leftSidebarOpen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize services sidebar"
          onMouseDown={(event) => startSidebarDrag("left", event)}
          className="group/lh absolute inset-y-0 z-20 w-1.5 -translate-x-1/2 cursor-col-resize"
          style={{ left: `${leftWidth}px` }}
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/lh:bg-emerald-500/60" />
        </div>
      ) : null}
      {rightSidebarOpen ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize details sidebar"
          onMouseDown={(event) => startSidebarDrag("right", event)}
          className="group/rh absolute inset-y-0 z-20 w-1.5 translate-x-1/2 cursor-col-resize"
          style={{ right: `${rightWidth}px` }}
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/rh:bg-emerald-500/60" />
        </div>
      ) : null}
    </main>
    {searchOpen ? (
      <GlobalSearch
        services={services}
        logs={logsRef.current}
        onJump={(serviceId) => setSelectedId(serviceId)}
        onClose={() => setSearchOpen(false)}
      />
    ) : null}
    </>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function groupKey(service: ServiceConfig) {
  return service.group?.trim() || "Ungrouped";
}

// Group services by `group`, preserving the order in which groups first appear
// and the order of services within each group. Returns [groupName, services][].
function groupServices(services: ServiceConfig[]): Array<[string, ServiceConfig[]]> {
  const order: string[] = [];
  const byGroup = new Map<string, ServiceConfig[]>();

  for (const service of services) {
    const key = groupKey(service);
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
      order.push(key);
    }
    byGroup.get(key)!.push(service);
  }

  return order.map((name) => [name, byGroup.get(name)!]);
}

async function openInEditor(
  cwd: string,
  serviceId: string,
  appendLog: (id: string, chunk: string) => void
) {
  try {
    await invoke("open_in_editor", { cwd });
  } catch (error) {
    appendLog(serviceId, `\r\n\x1b[31m[manager] open in editor failed: ${errorMessage(error)}\x1b[0m\r\n`);
  }
}

async function openInFileManager(
  cwd: string,
  serviceId: string,
  appendLog: (id: string, chunk: string) => void
) {
  try {
    await invoke("open_in_file_manager", { cwd });
  } catch (error) {
    appendLog(serviceId, `\r\n\x1b[31m[manager] open folder failed: ${errorMessage(error)}\x1b[0m\r\n`);
  }
}

async function openServiceUrl(
  port: number,
  serviceId: string,
  appendLog: (id: string, chunk: string) => void
) {
  try {
    await invoke("open_url", { url: `http://localhost:${port}` });
  } catch (error) {
    appendLog(serviceId, `\r\n\x1b[31m[manager] open url failed: ${errorMessage(error)}\x1b[0m\r\n`);
  }
}

// Format a unix-millis timestamp as a short relative string.
function timeAgo(timestamp: number | null): string {
  if (timestamp == null) {
    return "Never";
  }
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function errorMessage(error: unknown) {
  if (isBackendError(error)) {
    switch (error.code) {
      case "already_running":
      case "not_running":
      case "config_invalid":
      case "config_parse_error":
        return error.message;
      default:
        return error.message;
    }
  }

  return String(error);
}

function isBackendError(error: unknown): error is { code: string; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    typeof (error as { message: unknown }).message === "string"
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-[0.14em] text-zinc-500">{label}</dt>
      <dd className="mt-1 text-zinc-300">{children}</dd>
    </div>
  );
}

