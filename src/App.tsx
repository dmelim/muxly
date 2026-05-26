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
  AppSettings,
  ServiceConfig,
  ServiceHistory,
  ServiceIcon,
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
import { BottomTerminal } from "./BottomTerminal";
import { SettingsView } from "./SettingsView";
import { aliasProjectName } from "./privacyNames";
import { BuiltinServiceIcon } from "./serviceIcons";
import {
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  SplitIcon,
  StopIcon,
  TerminalIcon
} from "./icons";

type EditTarget =
  | { mode: "edit"; service: ServiceConfig }
  | { mode: "new" }
  | { mode: "import" };

// Auto-restart guardrails: per-service we re-spawn at most
// `settings.autoRestartMaxAttempts` times within
// `settings.autoRestartWindowMs` (both user-tunable via the Settings panel),
// pausing AUTO_RESTART_DELAY_MS between tries. Log retention
// (`settings.maxLogChunks`) is similarly user-tunable.
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
  running: "bg-cyan-400",
  stopping: "bg-orange-400",
  exited: "bg-sky-400",
  failed: "bg-rose-400"
};

// Pre-load placeholder — the Rust backend's `load_settings` runs on mount and
// overrides `editorCommand` with the real per-OS default (`code.cmd` on
// Windows, `code` elsewhere) or the user's saved value.
const DEFAULT_SETTINGS: AppSettings = {
  editorCommand: "code",
  hiddenProjectNames: {},
  projectNameAliases: {},
  // Mirrors the Rust defaults — kept in sync manually. The real values
  // arrive via `load_settings` on mount; these only apply until then.
  autoRestartMaxAttempts: 3,
  autoRestartWindowMs: 60_000,
  maxLogChunks: 5_000
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
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  // Mirrors `settings` so listeners with empty-deps useEffect closures
  // (process-exit auto-restart, output chunk buffering) read the latest
  // user-tunable values without having to re-mount on every settings change.
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [iconImages, setIconImages] = useState<Record<string, string | null>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  // The bottom shell drawer. Hidden by default — opened from the header button
  // or with Ctrl/Cmd+↓. Height is user-draggable from a handle on the drawer's
  // top edge; state lives here so it survives toggle/remount of the drawer.
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(288);
  // Drag-to-reorder state. `dragId` is the service currently being dragged;
  // `dropIndicator` is where the cyan "drop here" line / highlight is shown.
  // - "before-service": insert source just above this service (joining its group)
  // - "end-of-group": append source to the end of this group (and update its group field)
  // The ref mirrors `dragId` so the dragover handlers (which fire between
  // dragstart and React's next render) can read the active source
  // synchronously and call preventDefault — without it, the OS shows the
  // "forbidden" cursor on the very first dragover events.
  const [dragId, setDragId] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<
    | { kind: "before-service"; serviceId: string }
    | { kind: "end-of-group"; groupName: string }
    | null
  >(null);

  const beginDrag = useCallback((serviceId: string) => {
    dragIdRef.current = serviceId;
    setDragId(serviceId);
  }, []);

  const endDrag = useCallback(() => {
    dragIdRef.current = null;
    setDragId(null);
    setDropIndicator(null);
  }, []);

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

  const groupedServices = useMemo(() => groupServices(services), [services]);
  const groupNames = useMemo(
    () => groupedServices.map(([groupName]) => groupName),
    [groupedServices]
  );
  const projectNameAliases = useMemo(
    () => ensureProjectAliases(groupNames, settings),
    [groupNames, settings]
  );
  const displayProjectName = useCallback(
    (groupName: string) =>
      settings.hiddenProjectNames[groupName]
        ? projectNameAliases[groupName] ?? groupName
        : groupName,
    [projectNameAliases, settings.hiddenProjectNames]
  );

  // Services in the same order the sidebar renders them (grouped), so the
  // Ctrl+1..9 shortcuts line up with what the user sees.
  const flatServices = useMemo(
    () =>
      groupedServices.flatMap(([groupName, list]) =>
        collapsedGroups[groupName] ? [] : list
      ),
    [collapsedGroups, groupedServices]
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

  useEffect(() => {
    invoke<AppSettings>("load_settings")
      .then((loaded) => {
        setSettings(loaded);
      })
      .catch(() => {
        /* default settings stay in place */
      });
  }, []);

  // Keep the ref synced with the live settings so closures captured by the
  // long-lived event listeners always see the latest user-tunable values.
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const persistSettings = useCallback(
    async (nextSettings: AppSettings) => {
      const saved = await invoke<AppSettings>("save_settings", { settings: nextSettings });
      setSettings(saved);
      return saved;
    },
    []
  );

  useEffect(() => {
    if (sameAliases(settings.projectNameAliases, projectNameAliases)) {
      return;
    }

    void persistSettings({ ...settings, projectNameAliases }).catch((error) => {
      // Background alias-sync — surface to the dev console rather than the UI;
      // the user didn't initiate this and there's no obvious place to display it.
      console.warn("Failed to persist project name aliases:", errorMessage(error));
    });
  }, [persistSettings, projectNameAliases, settings]);

  useEffect(() => {
    let cancelled = false;
    const imageServices = services.filter((service) => service.icon?.type === "image");

    Promise.all(
      imageServices.map(async (service) => {
        const icon = service.icon as Extract<ServiceIcon, { type: "image" }>;
        try {
          const dataUrl = await invoke<string>("resolve_icon_image", {
            cwd: service.cwd,
            path: icon.path
          });
          return [service.id, dataUrl] as const;
        } catch {
          return [service.id, null] as const;
        }
      })
    ).then((resolved) => {
      if (cancelled) return;
      const next: Record<string, string | null> = {};
      for (const [serviceId, dataUrl] of resolved) {
        next[serviceId] = dataUrl;
      }
      setIconImages(next);
    });

    return () => {
      cancelled = true;
    };
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
      appendLog(serviceId, `\r\n\x1b[38;2;34;211;238m[manager] started pid ${pid}\x1b[0m\r\n`);
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
        `\r\n\x1b[38;2;34;211;238m[manager] process exited (${description})\x1b[0m\r\n`
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

      // Read user-tunable guardrails from the ref so changes in Settings take
      // effect immediately without needing to remount the listener.
      const { autoRestartMaxAttempts: maxAttempts, autoRestartWindowMs: windowMs } =
        settingsRef.current;
      if (maxAttempts <= 0) return;

      const now = Date.now();
      const record = autoRestartRef.current[serviceId] ?? { count: 0, lastAt: 0 };
      // A quiet period resets the budget — a service that ran fine for a while
      // and then crashed gets a fresh set of retries.
      if (now - record.lastAt > windowMs) {
        record.count = 0;
      }

      if (record.count >= maxAttempts) {
        appendLog(
          serviceId,
          `\r\n\x1b[31m[manager] auto-restart gave up after ${maxAttempts} attempts\x1b[0m\r\n`
        );
        return;
      }

      record.count += 1;
      record.lastAt = now;
      autoRestartRef.current[serviceId] = record;
      appendLog(
        serviceId,
        `\r\n\x1b[33m[manager] auto-restarting (attempt ${record.count}/${maxAttempts})\x1b[0m\r\n`
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

    const limit = settingsRef.current.maxLogChunks;
    if (chunks.length > limit) {
      chunks.splice(0, chunks.length - limit);
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
        `\r\n\x1b[38;2;34;211;238m[manager] starting ${formatCommand(service)}\x1b[0m\r\n`
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
      appendLog(service.id, `\r\n\x1b[38;2;34;211;238m[manager] stop requested\x1b[0m\r\n`);

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

  // Reorder a service via drag-and-drop. Mutates the flat services array (the
  // sidebar groups are derived from order + each service's `group` field) and
  // persists by calling save_services + reloading. Moving across groups also
  // rewrites the dragged service's `group` to match the target group.
  const reorderService = useCallback(
    async (
      sourceId: string,
      target:
        | { kind: "before-service"; serviceId: string }
        | { kind: "end-of-group"; groupName: string }
    ) => {
      const source = services.find((s) => s.id === sourceId);
      if (!source) return;

      const without = services.filter((s) => s.id !== sourceId);
      let newGroup: string | null = source.group ?? null;
      let insertAt: number;

      if (target.kind === "before-service") {
        if (target.serviceId === sourceId) return;
        const targetIndex = without.findIndex((s) => s.id === target.serviceId);
        if (targetIndex === -1) return;
        // Join the target's group so cross-group drag-onto-card moves the service.
        newGroup = without[targetIndex].group ?? null;
        insertAt = targetIndex;
      } else {
        newGroup = target.groupName === "Ungrouped" ? null : target.groupName;
        // Insert after the last service already in that group; if the group
        // is now empty (it only contained the dragged source) fall back to
        // appending at the end so the service still lands somewhere sane.
        let lastIndex = -1;
        without.forEach((s, i) => {
          if (groupKey(s) === target.groupName) lastIndex = i;
        });
        insertAt = lastIndex === -1 ? without.length : lastIndex + 1;
      }

      const updatedSource: ServiceConfig = { ...source, group: newGroup };
      const next = [
        ...without.slice(0, insertAt),
        updatedSource,
        ...without.slice(insertAt)
      ];

      if (sameServiceOrder(services, next)) return;

      try {
        await invoke("save_services", { services: next });
        await reloadServices();
      } catch (error) {
        setManagerMessage(errorMessage(error));
      }
    },
    [services, reloadServices]
  );

  const stopGroup = (groupName: string) => {
    services
      .filter((service) => groupKey(service) === groupName)
      .forEach((service) => {
        void stopService(service);
      });
  };

  const toggleGroupCollapsed = useCallback((groupName: string) => {
    setCollapsedGroups((current) => ({
      ...current,
      [groupName]: !current[groupName]
    }));
  }, []);

  // Drag-resize the bottom terminal drawer. Mirrors `startSidebarDrag`: window-
  // level listeners so the drag survives the cursor leaving the thin handle,
  // and a body-level cursor + user-select lock for the duration of the drag.
  // The drawer grows as the handle is dragged upward — `delta` is inverted.
  const startTerminalDrag = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = terminalHeight;
      document.body.style.userSelect = "none";
      document.body.style.cursor = "row-resize";

      const onMove = (move: MouseEvent) => {
        const delta = move.clientY - startY;
        // Cap at ~80% of viewport so the drawer can never eat the whole window
        // — the service panes still need to be visible to be useful.
        const maxHeight = Math.max(160, Math.round(window.innerHeight * 0.8));
        setTerminalHeight(clamp(startHeight - delta, 120, maxHeight));
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
    [terminalHeight]
  );

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

  const toggleProjectNamePrivacy = useCallback((groupName: string) => {
    const hidden = !settings.hiddenProjectNames[groupName];
    const nextSettings = {
      ...settings,
      hiddenProjectNames: {
        ...settings.hiddenProjectNames,
        [groupName]: hidden
      },
      projectNameAliases: hidden ? projectNameAliases : settings.projectNameAliases
    };

    void persistSettings(nextSettings).catch((error) => {
      console.warn("Failed to toggle project name privacy:", errorMessage(error));
    });
  }, [persistSettings, projectNameAliases, settings]);

  // Global keyboard shortcuts. Registered in the capture phase so they fire
  // before a focused terminal — xterm consumes Ctrl-combos and stops their
  // propagation, so a bubble-phase listener would never see them. For each
  // shortcut we handle, `stopPropagation` then keeps the key from also
  // reaching the terminal. Modifier combos are ignored while the user is
  // typing in a real form field.
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
        if (settingsOpen) {
          setSettingsOpen(false);
          return;
        }
        return;
      }

      const mod = event.ctrlKey || event.metaKey;
      if (!mod) {
        return;
      }

      // Ctrl/Cmd + Shift + F → global log search.
      if (event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        setSearchOpen(true);
        return;
      }

      if (event.altKey || event.shiftKey) {
        return;
      }

      // A real text field swallows the remaining shortcuts — but xterm's
      // hidden helper textarea is not real input, so shortcuts still work
      // while a terminal pane is focused.
      const target = event.target as HTMLElement | null;
      const isFormField =
        target != null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable) &&
        !target.classList.contains("xterm-helper-textarea");
      if (isFormField) {
        return;
      }

      // Ctrl/Cmd + ← / → → toggle the left / right side panels.
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        setLeftSidebarOpen((open) => !open);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        setRightSidebarOpen((open) => !open);
        return;
      }
      // Ctrl/Cmd + ↓ → toggle the bottom shell drawer.
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        setTerminalOpen((open) => !open);
        return;
      }

      // Ctrl/Cmd + 1..9 → open the Nth visible service as the sole pane.
      if (/^[1-9]$/.test(event.key)) {
        const service = flatServices[Number(event.key) - 1];
        if (service) {
          event.preventDefault();
          event.stopPropagation();
          openSingle(service.id);
        }
        return;
      }

      switch (event.key.toLowerCase()) {
        case "w":
          // Close the focused service pane. Only acts when the focused service
          // actually has an open pane — otherwise the shortcut is a no-op
          // rather than silently closing whatever happens to be leftmost.
          if (selected && paneIds.includes(selected.id)) {
            event.preventDefault();
            event.stopPropagation();
            closePane(selected.id);
          }
          break;
        case "r":
          if (selected) {
            event.preventDefault();
            event.stopPropagation();
            void manualStart(selected);
          }
          break;
        case "s":
          if (selected) {
            event.preventDefault();
            event.stopPropagation();
            void stopService(selected);
          }
          break;
        case "k":
          event.preventDefault();
          event.stopPropagation();
          clearSelectedLog();
          break;
        case "n":
          event.preventDefault();
          event.stopPropagation();
          setEditing({ mode: "new" });
          break;
        default:
          break;
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [
    editing,
    searchOpen,
    flatServices,
    selected,
    manualStart,
    stopService,
    clearSelectedLog,
    openSingle,
    paneIds,
    closePane,
    settingsOpen
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
          <h1 className="text-xl font-semibold tracking-normal">Muxly</h1>
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

        <div
          onDragEnter={(event) => {
            // HTML5 DnD requires preventDefault on BOTH dragenter and dragover
            // to fully suppress the OS forbidden-cursor — handling only
            // dragover leaves a flash every time the cursor crosses an element
            // boundary (between cards, into a header, etc.).
            if (dragIdRef.current) event.preventDefault();
          }}
          onDragOver={(event) => {
            // Safety net: keep the OS "move" cursor (not the forbidden icon)
            // anywhere inside the sidebar while a drag is in progress, even in
            // the gaps between cards and group headers. Specific targets below
            // still set the visual drop indicator.
            if (dragIdRef.current) event.preventDefault();
          }}
          className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden p-3"
        >
          {groupedServices.map(([groupName, groupServicesList]) => {
            const anyRunning = groupServicesList.some((service) => {
              const status = statuses[service.id];
              return status === "running" || status === "starting";
            });
            const collapsed = collapsedGroups[groupName] ?? false;
            const groupHidden = settings.hiddenProjectNames[groupName] ?? false;
            const displayGroupName = displayProjectName(groupName);

            const headerHighlighted =
              dropIndicator?.kind === "end-of-group" &&
              dropIndicator.groupName === groupName;

            return (
              <div key={groupName} className="space-y-1.5">
                <div
                  onDragOver={(event) => {
                    if (!dragIdRef.current) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setDropIndicator((current) =>
                      current?.kind === "end-of-group" && current.groupName === groupName
                        ? current
                        : { kind: "end-of-group", groupName }
                    );
                  }}
                  onDragLeave={(event) => {
                    // Only clear if leaving the header for something outside it —
                    // moving across child elements inside still fires dragleave.
                    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                    setDropIndicator((current) =>
                      current?.kind === "end-of-group" && current.groupName === groupName
                        ? null
                        : current
                    );
                  }}
                  onDrop={(event) => {
                    const sourceId = dragIdRef.current;
                    if (!sourceId) return;
                    event.preventDefault();
                    endDrag();
                    void reorderService(sourceId, { kind: "end-of-group", groupName });
                  }}
                  className={`flex items-center justify-between gap-2 rounded px-2 pt-1 transition ${
                    headerHighlighted ? "bg-cyan-400/15" : ""
                  }`}
                >
                  <Tooltip label={displayGroupName} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleGroupCollapsed(groupName)}
                      aria-expanded={!collapsed}
                      aria-label={`${collapsed ? "Expand" : "Collapse"} ${displayGroupName}`}
                      className="group/header flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
                    >
                      <ChevronRightIcon
                        className={`size-3 shrink-0 transition-transform ${
                          collapsed ? "" : "rotate-90"
                        }`}
                      />
                      <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.18em]">
                        {displayGroupName}
                      </span>
                    </button>
                  </Tooltip>
                  <div className="flex shrink-0 gap-0.5">
                    <Tooltip label={groupHidden ? "Show project name" : "Hide project name"}>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => toggleProjectNamePrivacy(groupName)}
                        aria-label={
                          groupHidden
                            ? `Show project name for ${displayGroupName}`
                            : `Hide project name for ${displayGroupName}`
                        }
                        aria-pressed={groupHidden}
                      >
                        {groupHidden ? (
                          <EyeOffIcon className="size-3.5" />
                        ) : (
                          <EyeIcon className="size-3.5" />
                        )}
                      </Button>
                    </Tooltip>
                    <Tooltip label={`Start all in ${displayGroupName}`}>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => startGroup(groupName)}
                        aria-label={`Start all services in ${displayGroupName}`}
                        className="text-cyan-400/80 hover:text-cyan-300"
                      >
                        <PlayIcon className="size-3.5" />
                      </Button>
                    </Tooltip>
                    <Tooltip label={`Stop all in ${displayGroupName}`}>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => stopGroup(groupName)}
                        disabled={!anyRunning}
                        aria-label={`Stop all running services in ${displayGroupName}`}
                        className="text-rose-400/80 hover:text-rose-300 disabled:text-zinc-500"
                      >
                        <StopIcon className="size-3.5" />
                      </Button>
                    </Tooltip>
                  </div>
                </div>
                <div className={collapsed ? "hidden" : "space-y-1.5"}>
                  {groupServicesList.map((service) => {
                    const status = statuses[service.id] ?? "stopped";
                    const isOpen = paneIds.includes(service.id);
                    const showConflict =
                      service.port != null &&
                      portConflicts[service.id] &&
                      status !== "running" &&
                      status !== "starting" &&
                      status !== "stopping";

                    const showDropLine =
                      dropIndicator?.kind === "before-service" &&
                      dropIndicator.serviceId === service.id &&
                      dragId !== service.id;
                    const isDragging = dragId === service.id;

                    return (
                      <div key={service.id} className="relative">
                        <span
                          aria-hidden="true"
                          className={`pointer-events-none absolute -top-1 left-0 right-0 h-0.5 rounded-full bg-cyan-400 transition-opacity ${
                            showDropLine ? "opacity-100" : "opacity-0"
                          }`}
                        />
                      <div
                        draggable
                        onDragStart={(event) => {
                          beginDrag(service.id);
                          event.dataTransfer.effectAllowed = "move";
                          // Some platforms require a data payload for drag to initiate.
                          try {
                            event.dataTransfer.setData("text/plain", service.id);
                          } catch {
                            /* Safari may throw on some MIME types — ignore. */
                          }
                        }}
                        onDragEnd={endDrag}
                        onDragOver={(event) => {
                          const sourceId = dragIdRef.current;
                          if (!sourceId || sourceId === service.id) return;
                          event.preventDefault();
                          event.stopPropagation();
                          event.dataTransfer.dropEffect = "move";
                          setDropIndicator((current) =>
                            current?.kind === "before-service" && current.serviceId === service.id
                              ? current
                              : { kind: "before-service", serviceId: service.id }
                          );
                        }}
                        onDrop={(event) => {
                          const sourceId = dragIdRef.current;
                          if (!sourceId || sourceId === service.id) return;
                          event.preventDefault();
                          event.stopPropagation();
                          endDrag();
                          void reorderService(sourceId, {
                            kind: "before-service",
                            serviceId: service.id
                          });
                        }}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          if (event.ctrlKey || event.metaKey) {
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
                        className={`group/card relative w-full cursor-pointer rounded-md px-3 py-3 text-left transition ${
                          isDragging ? "opacity-40 " : ""
                        }${
                          selected?.id === service.id || isOpen
                            ? "bg-white/10 text-white"
                            : "text-zinc-300 hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="flex min-w-0 items-center gap-3">
                            <ServiceIconBadge
                              service={service}
                              imageSrc={iconImages[service.id]}
                              status={status}
                            />
                            <span className="truncate text-sm font-medium">{service.name}</span>
                          </span>
                          {!isOpen ? (
                            <span className="shrink-0 text-xs text-zinc-500">
                              {statusLabels[status]}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block truncate pl-10 font-mono text-xs text-zinc-500">
                          {formatCommand(service)}
                        </span>
                        {showConflict ? (
                          <span className="mt-1 block pl-10 text-[11px] text-amber-300">
                            ⚠ port {service.port} in use
                          </span>
                        ) : null}
                        {isOpen ? (
                          <Tooltip
                            label="Open in a pane"
                            className="absolute top-2 right-2 text-cyan-400"
                          >
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="size-4"
                              aria-hidden="true"
                            >
                              <path d="m7 11 2-2-2-2" />
                              <path d="M11 13h4" />
                              <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
                            </svg>
                          </Tooltip>
                        ) : null}
                        <Tooltip label="Open in split view" className="absolute bottom-2 right-2">
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
                      </div>
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
          <Tooltip label={`${leftSidebarOpen ? "Hide" : "Show"} services (${modKey}+←)`}>
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
            <Tooltip label={`${terminalOpen ? "Hide" : "Show"} terminal (${modKey}+↓)`}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTerminalOpen((open) => !open)}
                aria-label="Toggle terminal"
                aria-pressed={terminalOpen}
                className={terminalOpen ? "text-cyan-400" : ""}
              >
                <TerminalIcon className="size-4" />
              </Button>
            </Tooltip>
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
            <Tooltip label={settingsOpen ? "Close settings" : "Settings"}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setSettingsOpen((open) => !open)}
                aria-label="Toggle settings"
                aria-pressed={settingsOpen}
                className={settingsOpen ? "text-cyan-400" : ""}
              >
                <SettingsIcon className="size-4" />
              </Button>
            </Tooltip>
            <span className="mx-1 h-5 w-px bg-white/10" />
            <Tooltip
              label={`${rightSidebarOpen ? "Hide" : "Show"} details (${modKey}+→)`}
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

        {/*
          Keep the terminal panes / bottom drawer mounted while Settings is
          open and just hide them — unmounting would dispose every xterm
          instance and wipe scrollback, which is a noticeable UX regression.
        */}
        <div
          className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
            settingsOpen ? "hidden" : ""
          }`}
        >
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
          <BottomTerminal
            open={terminalOpen}
            height={terminalHeight}
            onClose={() => setTerminalOpen(false)}
            onResizeStart={startTerminalDrag}
          />
        </div>
        {settingsOpen ? (
          <SettingsView
            settings={settings}
            services={services}
            onClose={() => setSettingsOpen(false)}
            onSave={(next) => persistSettings(next)}
          />
        ) : null}
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
                onClick={() =>
                  openInEditor(selected.cwd, selected.id, settings.editorCommand, appendLog)
                }
              >
                Open in editor
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
              <Detail label="Icon">
                <ServiceIconBadge
                  service={selected}
                  imageSrc={iconImages[selected.id]}
                  status={statuses[selected.id] ?? "stopped"}
                  large
                />
              </Detail>
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
              <Detail label="Group">
                {selected.group ? displayProjectName(groupKey(selected)) : "None"}
              </Detail>
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
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/lh:bg-cyan-500/60" />
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
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover/rh:bg-cyan-500/60" />
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

function ensureProjectAliases(groupNames: string[], settings: AppSettings) {
  let aliases = settings.projectNameAliases;

  for (const groupName of groupNames) {
    if (aliases[groupName]) continue;
    if (aliases === settings.projectNameAliases) {
      aliases = { ...settings.projectNameAliases };
    }
    aliases[groupName] = aliasProjectName(groupName, {
      ...settings,
      projectNameAliases: aliases
    });
  }

  return aliases;
}

// True iff two service lists describe the same order *and* same group membership.
// Used to skip a save_services round-trip when a drag drops a service back
// where it already was.
function sameServiceOrder(left: ServiceConfig[], right: ServiceConfig[]) {
  if (left.length !== right.length) return false;
  return left.every(
    (service, i) =>
      service.id === right[i].id && (service.group ?? null) === (right[i].group ?? null)
  );
}

function sameAliases(left: Record<string, string>, right: Record<string, string>) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([key, value]) => right[key] === value);
}

function ServiceIconBadge({
  service,
  imageSrc,
  status,
  large = false
}: {
  service: ServiceConfig;
  imageSrc?: string | null;
  status: ServiceStatus;
  large?: boolean;
}) {
  const size = large ? "size-10" : "size-7";
  const dotSize = large ? "size-2.5" : "size-2";
  return (
    <span
      className={`relative inline-flex ${size} shrink-0 items-center justify-center rounded-md border border-white/10 bg-black/25 text-zinc-300`}
      aria-hidden="true"
    >
      <span className="flex h-full w-full items-center justify-center overflow-hidden rounded-[inherit]">
        <ServiceIconContent icon={service.icon} imageSrc={imageSrc} large={large} />
      </span>
      <span
        className={`absolute -bottom-px -right-px ${dotSize} rounded-full ring-2 ring-[#15181d] ${
          statusDots[status]
        }`}
      />
    </span>
  );
}

function ServiceIconContent({
  icon,
  imageSrc,
  large
}: {
  icon?: ServiceIcon | null;
  imageSrc?: string | null;
  large: boolean;
}) {
  if (icon?.type === "emoji") {
    return <span className={large ? "text-lg" : "text-sm"}>{icon.value}</span>;
  }
  if (icon?.type === "image" && imageSrc) {
    return <img src={imageSrc} alt="" className="h-full w-full object-cover" />;
  }
  if (icon?.type === "builtin") {
    return <BuiltinServiceIcon name={icon.value} className={large ? "size-5" : "size-4"} />;
  }
  return <BuiltinServiceIcon name="terminal" className={large ? "size-5" : "size-4"} />;
}

async function openInEditor(
  cwd: string,
  serviceId: string,
  editorCommand: string,
  appendLog: (id: string, chunk: string) => void
) {
  try {
    await invoke("open_in_editor", { cwd, editorCommand });
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
