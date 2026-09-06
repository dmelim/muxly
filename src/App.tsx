import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import type {
  ProcessExitedEvent,
  ProcessFailedEvent,
  ProcessOutputEvent,
  ProcessStartedEvent,
  AppSettings,
  LoadedServices,
  RuntimeRequirementReport,
  ServiceConfig,
  ServiceHistory,
  ServiceIcon,
  ServiceStatus,
  WorkspacePanel
} from "./types";
import { PROCESS_EXITED, PROCESS_FAILED, PROCESS_STARTED, SERVICES_CHANGED } from "./events";
import { formatCommand, displayServiceName, redactSensitive } from "./types";
import { CommandPalette } from "./CommandPalette";
import type { Command } from "./CommandPalette";
import { ProfilePrompt } from "./ProfilePrompt";
import { RuntimeRequirements } from "./RuntimeRequirements";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";
import { GlobalSearch } from "./GlobalSearch";
import { TerminalPanes } from "./TerminalPanes";
import { BottomTerminal } from "./BottomTerminal";
import { SettingsView } from "./SettingsView";
import { DetailsSidebar } from "./DetailsSidebar";
import { ServicesSidebar } from "./ServicesSidebar";
import { describeExitCode, shortExitCode } from "./exitCodes";
import { StartupScreen } from "./StartupScreen";
import { runPortCheck, runRuntimeCheck, startupMark, mirrorBootTheme } from "./startup";
import { applyTheme, resolveTheme, type MuxlyTheme } from "./theme";
import { fuzzySearchMatches } from "./search";
import type { EditTarget, StartHealth } from "./appTypes";
import {
  AUTO_RESTART_DELAY_MS,
  PTY_WATCHDOG_MS,
  PTY_RECYCLE_MAX,
  DEFAULT_SETTINGS,
  annotateChunkWithTimestamps,
  clamp,
  ensureProjectAliases,
  errorMessage,
  groupKey,
  groupServices,
  isServiceInProfile,
  isWindows,
  modKey,
  sameAliases,
  sameServiceOrder,
  visibleForProfile
} from "./appUtils";
import {
  AlertTriangleIcon,
  CommandIcon,
  PanelLeftIcon,
  PanelRightIcon,
  SearchIcon,
  SettingsIcon,
  TerminalIcon
} from "./icons";

const PTY_CARRIAGE_RETURN_SETTLE_MS = 75;

// How long the one-shot "waiting for output…" hint stays up after a *user-
// initiated* PTY start when no real output has arrived yet. It also clears the
// instant real output lands. Deliberately one-shot: automatic recycles and
// auto-restarts do NOT re-show it — only a fresh Start/Restart does.
const WAITING_FOR_OUTPUT_MAX_MS = 8_000;

type PendingPtyCarriageReturn = {
  text: string;
  timer: ReturnType<typeof window.setTimeout>;
};

// Opt-in tracing for PTY start/watchdog behaviour, to debug ConPTY deadlocks
// (a start that hangs with no real output). Off unless explicitly enabled, so
// it costs nothing in normal use. Turn it on from the devtools console and
// reproduce a stuck restart:
//   localStorage.setItem("muxly:ptyDebug", "1")   // then reproduce
//   localStorage.removeItem("muxly:ptyDebug")      // to turn back off
// Lines land as `[pty-debug] <serviceId> …` in the devtools console.
function ptyDebug(serviceId: string, message: string, detail?: unknown) {
  try {
    if (localStorage.getItem("muxly:ptyDebug") !== "1") return;
  } catch {
    return;
  }
  if (detail !== undefined) {
    console.debug(`[pty-debug] ${serviceId} ${message}`, detail);
  } else {
    console.debug(`[pty-debug] ${serviceId} ${message}`);
  }
}

export function App() {
  const [services, setServices] = useState<ServiceConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  // Panels are layout columns/tiles. Each panel owns tabs and one active tab.
  const [workspacePanels, setWorkspacePanels] = useState<WorkspacePanel[]>([]);
  const workspacePanelsRef = useRef<WorkspacePanel[]>([]);
  workspacePanelsRef.current = workspacePanels;
  const [focusedPanelId, setFocusedPanelId] = useState<string | null>(null);
  const focusedPanelIdRef = useRef<string | null>(null);
  focusedPanelIdRef.current = focusedPanelId;
  const paneIds = useMemo(
    () => Array.from(new Set(workspacePanels.flatMap((panel) => panel.tabIds))),
    [workspacePanels]
  );
  const [statuses, setStatuses] = useState<Record<string, ServiceStatus>>({});
  const [pids, setPids] = useState<Record<string, number>>({});
  // The port a running service actually bound to (from PROCESS_STARTED). For an
  // auto-port service this may differ from its configured preference; cleared
  // on exit. Drives the "Open localhost:N" affordance and the manager note.
  const [actualPorts, setActualPorts] = useState<Record<string, number>>({});
  // Mirror of `actualPorts` for the once-mounted watchdog/probe closures, which
  // need the live bound port without re-subscribing on every change.
  const actualPortsRef = useRef<Record<string, number>>({});
  const [lastExit, setLastExit] = useState<Record<string, string>>({});
  // PTY services only: true from PROCESS_STARTED until the run produces its
  // first real (newline) output. Drives the in-pane "waiting for output…"
  // affordance so a briefly-silent or recycling start never just looks hung.
  const [awaitingOutput, setAwaitingOutput] = useState<Record<string, boolean>>({});
  // Surfaced health of an in-progress start that hasn't produced output yet
  // (see StartHealth). A service WITH a port is never killed on silence — we
  // show `waiting-port` and let its port-readiness probe decide. A portless
  // service falls back to the output watchdog (`retrying`/`stuck`). Cleared on
  // first real output, the port coming up, a fresh user start, or a real stop.
  const [startHealth, setStartHealth] = useState<Record<string, StartHealth>>({});
  const [managerMessage, setManagerMessage] = useState("Loading service config...");
  const [runtimeReport, setRuntimeReport] = useState<RuntimeRequirementReport | null>(null);
  const [runtimeWarningOpen, setRuntimeWarningOpen] = useState(false);
  // One xterm terminal per open pane, keyed by service id.
  const terminalsRef = useRef<Map<string, Terminal>>(new Map());
  const logRevisionsRef = useRef<Record<string, number>>({});
  const logsRef = useRef<Record<string, string[]>>({});
  // Live terminal writes are coalesced to one flush per animation frame. A
  // single PTY read can arrive split across frames — a readline backspace
  // redraw (carriage-return to column 0, then reprint) is the common case —
  // and writing each piece the instant it lands lets xterm paint the
  // intermediate cursor position for a frame, seen as a cursor flicker.
  // Buffering per service and flushing once per frame merges same-frame pieces
  // into a single paint. `logsRef` above stays the source of truth for the
  // pane-mount replay; this only affects the live append.
  const pendingWritesRef = useRef<Map<string, string>>(new Map());
  const flushRafRef = useRef(0);
  // Windows ConPTY can split readline redraws into a bare carriage return and a
  // later repaint. Hold that standalone CR briefly so xterm does not paint the
  // cursor at column 0 between the two chunks. Windows only — see
  // `enqueueLiveTerminalWrite`.
  const pendingPtyCarriageReturnsRef = useRef<Map<string, PendingPtyCarriageReturn>>(new Map());
  // Per-service line-start tracker for the timestamp annotator. `true` means
  // the next non-newline byte we append begins a fresh line and should get a
  // [HH:MM:SS] marker; flips to false after one is emitted and back to true
  // after every `\n`. Lives in a ref so streamed chunks (which can arrive
  // partway through a line) keep their state across renders without
  // invalidating any memos.
  const lineStateRef = useRef<Record<string, boolean>>({});
  const outputChannelsRef = useRef<Record<string, Channel<ProcessOutputEvent>>>({});
  // Kept in sync with `services` so closures captured by the long-lived event
  // listeners (which only mount once) always see the latest config.
  const servicesRef = useRef<ServiceConfig[]>([]);
  // Stream mode and the project-name aliases, mirrored into refs so the
  // long-lived output closure (appendLog) can redact sensitive paths in live
  // log chunks without being re-created on every toggle.
  const streamModeRef = useRef(false);
  const projectNameAliasesRef = useRef<Record<string, string>>({});
  // Per-service auto-restart bookkeeping: how many times we've re-spawned and
  // when the last attempt happened, so we can enforce the retry cap/window.
  const autoRestartRef = useRef<Record<string, { count: number; lastAt: number }>>({});
  // Lets the once-mounted exit listener call the latest startService closure.
  const startServiceRef = useRef<(service: ServiceConfig) => Promise<void>>(async () => {});
  // Backend run token for each service's current live run. A fast restart can
  // leave stale output/exit/failure events from the old run in flight.
  const activeRunTokensRef = useRef<Record<string, number>>({});
  // Services the user asked to *restart* while they were still running. Starting
  // alone is a no-op against a live process, so a restart stops the service and
  // records the id here; the exit handler re-spawns it once its exit lands.
  const pendingRestartRef = useRef<Set<string>>(new Set());
  // PTY deadlock watchdog bookkeeping. `sawPtyOutputRef` maps a service to the
  // run token that has produced real process output (proof the PTY came up).
  // `ptyRecycleRef` counts how many times we've recycled a stuck start so the
  // retries are capped. See PTY_WATCHDOG_MS / PTY_RECYCLE_MAX.
  const sawPtyOutputRef = useRef<Record<string, number>>({});
  const ptyRecycleRef = useRef<Record<string, number>>({});
  // Service ids whose *next* PROCESS_STARTED was triggered by an explicit user
  // Start/Restart (not an automatic recycle/auto-restart). Consumed once on that
  // start to show the one-shot "waiting for output…" hint, then cleared.
  const userStartedRef = useRef<Set<string>>(new Set());
  // Pending hide-timers for the "waiting for output…" hint, keyed by service id,
  // so a stale timer can't hide a fresh hint and we can cancel on output/exit.
  const awaitingTimersRef = useRef<Record<string, ReturnType<typeof window.setTimeout>>>({});
  const [editing, setEditing] = useState<EditTarget | null>(null);
  // Map of serviceId → true when its configured port is held by another process.
  // Only meaningful when the service is not running — we never flag our own
  // listener as a "conflict".
  const [portConflicts, setPortConflicts] = useState<Record<string, boolean>>({});
  // After a service exits non-zero and we can still see something listening
  // on its configured port, we resolve the holder PID and surface a
  // "stop-and-restart / adopt" banner in the pane. Cleared when the user
  // takes either action or when the service starts successfully.
  const [portBlockers, setPortBlockers] = useState<
    Record<string, { pid: number; port: number }>
  >({});
  // Services the user has chosen to "adopt" — i.e. treat the external
  // process holding the port as if it were this service. We don't own its
  // stdout/stderr but we do show it as running and route Stop to kill the
  // adopted PID. Periodically reconciled against the live port holder so an
  // externally-killed dev server doesn't stay stuck in "Adopted".
  const [adoptedPids, setAdoptedPids] = useState<
    Record<string, { pid: number; port: number }>
  >({});
  const [history, setHistory] = useState<Record<string, ServiceHistory>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [serviceQuery, setServiceQuery] = useState("");
  // Service id whose in-pane find bar is currently shown — null when closed.
  // Only one pane shows the bar at a time; switching focus or closing the
  // pane clears it.
  const [searchPaneId, setSearchPaneId] = useState<string | null>(null);
  // When the global search modal jumps to a result, we hand the query off
  // to the destination pane so its in-pane search bar opens pre-filled and
  // its xterm SearchAddon highlights the matched line. Cleared after the
  // pane consumes it.
  const [paneSearchSeed, setPaneSearchSeed] = useState<{
    serviceId: string;
    query: string;
    // Bump counter so the same query → same pane jump still re-triggers the
    // SearchAddon and re-runs the flash animation when re-clicked.
    nonce: number;
  } | null>(null);
  // Service id whose pane should briefly flash amber to confirm the jump.
  // Auto-clears after ~1.2s so the .pane-flash class can be re-applied on
  // the next jump.
  const [flashServiceId, setFlashServiceId] = useState<string | null>(null);
  const [flashNonce, setFlashNonce] = useState(0);
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(340);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [servicesLoaded, setServicesLoaded] = useState(false);
  const workspaceRestoredRef = useRef(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  // Mirrors `settings` so listeners with empty-deps useEffect closures
  // (process-exit auto-restart, output chunk buffering) read the latest
  // user-tunable values without having to re-mount on every settings change.
  const settingsRef = useRef<AppSettings>(DEFAULT_SETTINGS);
  // Settings commands write complete snapshots. Serialize them so a slower
  // earlier request can never land after a newer one and restore stale fields.
  // The ref advances optimistically, allowing rapid actions to build on every
  // change even before React has rendered the first saved snapshot.
  const settingsWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [iconImages, setIconImages] = useState<Record<string, string | null>>({});
  // Project collapse state is persisted in settings (see `collapsedProjectNames`)
  // so a minimized project stays minimized across restarts.
  const collapsedGroups = settings.collapsedProjectNames;
  // The bottom shell drawer. Hidden by default — opened from the header button
  // or with Ctrl/Cmd+↓. Height is user-draggable from a handle on the drawer's
  // top edge; state lives here so it survives toggle/remount of the drawer.
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useState(288);
  // Command palette (Ctrl/Cmd+P). A lightweight registry of named actions.
  const [commandOpen, setCommandOpen] = useState(false);
  const [profilePromptOpen, setProfilePromptOpen] = useState(false);
  // Stream mode: when on, services flagged `sensitive` have their names masked
  // across the UI so the window is safe to screen-share. Ephemeral (session
  // only) — toggled from the command palette, restored when you toggle it off.
  const [streamMode, setStreamMode] = useState(false);
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
  // Reordering whole groups is a separate gesture from reordering services
  // (you drag a group's grip handle, not a card). It has its own drag state so
  // the two never interfere: a service drag sets `dragIdRef`, a group drag sets
  // `dragGroupRef`, and the sidebar's shared drop handlers branch on which is
  // active. The "group" drop indicator carries an edge so a group can be
  // dropped after the last one, not just before some other group.
  const [dragGroup, setDragGroup] = useState<string | null>(null);
  const dragGroupRef = useRef<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<
    | { kind: "before-service"; serviceId: string }
    | { kind: "end-of-group"; groupName: string }
    | { kind: "group"; groupName: string; edge: "before" | "after" }
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

  const beginGroupDrag = useCallback((groupName: string) => {
    dragGroupRef.current = groupName;
    setDragGroup(groupName);
  }, []);

  const endGroupDrag = useCallback(() => {
    dragGroupRef.current = null;
    setDragGroup(null);
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

  const activeProfile = settings.activeProfile ?? null;
  const [previewTheme, setPreviewTheme] = useState<MuxlyTheme | null>(null);
  const savedTheme = useMemo(
    () => resolveTheme(settings.themePreset, settings.theme),
    [settings.theme, settings.themePreset]
  );

  const resolvedTheme = previewTheme ?? savedTheme;
  useEffect(() => {
    if (settingsLoaded) mirrorBootTheme(savedTheme);
  }, [savedTheme, settingsLoaded]);
  useEffect(() => {
    if (workspaceReady) startupMark("workspace ready");
  }, [workspaceReady]);

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Services visible under the active profile (the active one plus all
  // unassigned). "All profiles" returns the full list untouched.
  const visibleServices = useMemo(
    () => visibleForProfile(services, activeProfile),
    [services, activeProfile]
  );

  // The focused service drives the toolbar and inspector. Falls back to the
  // first open pane (e.g. after the focused pane is closed), then any visible
  // service. A selected service hidden by the active profile is ignored so the
  // inspector never shows something outside the current view.
  const selected = useMemo(() => {
    const byId = services.find((service) => service.id === selectedId);
    const focused = byId && paneIds.includes(byId.id) ? byId : null;
    return focused ?? paneServices[0] ?? visibleServices[0] ?? null;
  }, [selectedId, services, paneIds, paneServices, visibleServices]);

  const groupNames = useMemo(
    () => groupServices(services).map(([groupName]) => groupName),
    [services]
  );
  const projectNameAliases = useMemo(
    () => ensureProjectAliases(groupNames, settings),
    [groupNames, settings]
  );
  const searchedServices = useMemo(() => {
    const query = serviceQuery.trim();
    if (!query) return visibleServices;
    return visibleServices.filter((service) => {
      const alias = projectNameAliases[groupKey(service)] ?? "";
      const values = streamMode && service.sensitive
        ? [displayServiceName(service, true), alias, redactSensitive(formatCommand(service), service, alias, true)]
        : [service.name, service.id, service.group ?? "", service.program, ...service.args];
      return fuzzySearchMatches(query, values);
    });
  }, [projectNameAliases, serviceQuery, streamMode, visibleServices]);
  const groupedServices = useMemo(
    () =>
      groupServices(searchedServices).sort(
        ([leftGroup], [rightGroup]) =>
          Number(Boolean(settings.pinnedProjectNames?.[rightGroup])) -
          Number(Boolean(settings.pinnedProjectNames?.[leftGroup]))
      ),
    [searchedServices, settings.pinnedProjectNames]
  );
  // Mirror into refs so the once-mounted output closure can redact paths with
  // the current values without re-subscribing on every toggle (same pattern as
  // PaneView's streamModeRef).
  projectNameAliasesRef.current = projectNameAliases;
  streamModeRef.current = streamMode;
  // A project name is replaced by its alias for either of two independent
  // reasons: the manual sidebar toggle (`hiddenProjectNames`) is on, which
  // hides it regardless of stream mode; or stream mode is on and the project is
  // flagged sensitive (`sensitiveProjectNames`). The two never affect each
  // other — stream mode is sovereign over sensitive items, the toggle is manual.
  const displayProjectName = useCallback(
    (groupName: string) =>
      settings.hiddenProjectNames[groupName] ||
      (streamMode && settings.sensitiveProjectNames[groupName])
        ? projectNameAliases[groupName] ?? groupName
        : groupName,
    [projectNameAliases, settings.hiddenProjectNames, settings.sensitiveProjectNames, streamMode]
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

  const focusPanelTab = useCallback((panelId: string, serviceId: string) => {
    setWorkspacePanels((current) =>
      current.map((panel) =>
        panel.id === panelId ? { ...panel, activeTabId: serviceId } : panel
      )
    );
    setFocusedPanelId(panelId);
    setSelectedId(serviceId);
  }, []);

  const movePanelTab = useCallback(
    (serviceId: string, targetPanelId: string, requestedTargetIndex: number) => {
      const current = workspacePanelsRef.current;
      const sourcePanel = current.find((panel) => panel.tabIds.includes(serviceId));
      const targetPanel = current.find((panel) => panel.id === targetPanelId);
      if (!sourcePanel || !targetPanel) return;

      const sourceIndex = sourcePanel.tabIds.indexOf(serviceId);
      let next: WorkspacePanel[];

      if (sourcePanel.id === targetPanel.id) {
        const tabIds = sourcePanel.tabIds.filter((id) => id !== serviceId);
        let targetIndex = Math.max(0, Math.min(requestedTargetIndex, sourcePanel.tabIds.length));
        if (sourceIndex < targetIndex) targetIndex -= 1;
        targetIndex = Math.max(0, Math.min(targetIndex, tabIds.length));
        tabIds.splice(targetIndex, 0, serviceId);
        next = current.map((panel) =>
          panel.id === sourcePanel.id ? { ...panel, tabIds, activeTabId: serviceId } : panel
        );
      } else {
        const sourceTabs = sourcePanel.tabIds.filter((id) => id !== serviceId);
        const targetTabs = targetPanel.tabIds.filter((id) => id !== serviceId);
        const targetIndex = Math.max(0, Math.min(requestedTargetIndex, targetTabs.length));
        targetTabs.splice(targetIndex, 0, serviceId);
        const sourceActiveTabId =
          sourcePanel.activeTabId === serviceId && sourceTabs.length > 0
            ? sourceTabs[Math.min(sourceIndex, sourceTabs.length - 1)]
            : sourcePanel.activeTabId;

        next = current.flatMap((panel) => {
          if (panel.id === sourcePanel.id) {
            return sourceTabs.length > 0
              ? [{ ...panel, tabIds: sourceTabs, activeTabId: sourceActiveTabId }]
              : [];
          }
          if (panel.id === targetPanel.id) {
            return [{ ...panel, tabIds: targetTabs, activeTabId: serviceId }];
          }
          return [panel];
        });
      }

      workspacePanelsRef.current = next;
      setWorkspacePanels(next);
      setFocusedPanelId(targetPanelId);
      setSelectedId(serviceId);
    },
    []
  );

  const focusExistingTab = useCallback((serviceId: string) => {
    const panel = workspacePanels.find((candidate) => candidate.tabIds.includes(serviceId));
    if (!panel) return false;
    focusPanelTab(panel.id, serviceId);
    return true;
  }, [focusPanelTab, workspacePanels]);

  // Explicit jump actions use the same focused-panel tab behavior as a normal
  // service click rather than destroying the rest of the workspace.
  const openService = useCallback((serviceId: string) => {
    if (focusExistingTab(serviceId)) return;
    const panelId = focusedPanelId ?? workspacePanels[0]?.id ?? crypto.randomUUID();
    setWorkspacePanels((current) => {
      if (current.length === 0) {
        return [{ id: panelId, tabIds: [serviceId], activeTabId: serviceId }];
      }
      return current.map((panel) =>
        panel.id === panelId
          ? {
              ...panel,
              tabIds: settingsRef.current.openServicesInTabs
                ? [...panel.tabIds, serviceId]
                : [serviceId],
              activeTabId: serviceId
            }
          : panel
      );
    });
    setFocusedPanelId(panelId);
    setSelectedId(serviceId);
  }, [focusExistingTab, focusedPanelId, workspacePanels]);

  // Ctrl/Cmd-click creates a panel. Existing tabs are focused rather than
  // duplicated because one live xterm instance belongs to each service.
  const openInSplit = useCallback((serviceId: string) => {
    if (focusExistingTab(serviceId)) return;
    const panelId = crypto.randomUUID();
    setWorkspacePanels((current) => [
      ...current,
      { id: panelId, tabIds: [serviceId], activeTabId: serviceId }
    ]);
    setFocusedPanelId(panelId);
    setSelectedId(serviceId);
  }, [focusExistingTab]);

  // Auto-clear the flash so the CSS animation can re-fire on the next jump
  // (re-adding the same class to an element doesn't restart its animation).
  useEffect(() => {
    if (!flashServiceId) return;
    const timer = window.setTimeout(() => setFlashServiceId(null), 1200);
    return () => window.clearTimeout(timer);
  }, [flashServiceId, flashNonce]);

  // Called from the global search modal when the user clicks a result.
  // Ensures the service is visible as a pane (adds one if needed), focuses
  // it, opens its in-pane search bar pre-filled with the query, and flashes
  // the pane to confirm the jump.
  const jumpToSearchResult = useCallback(
    (serviceId: string, query: string) => {
      openService(serviceId);
      setSearchPaneId(serviceId);
      setPaneSearchSeed({ serviceId, query, nonce: Date.now() });
      setFlashServiceId(serviceId);
      setFlashNonce((n) => n + 1);
    },
    [openService]
  );

  const closePane = useCallback((serviceId: string, requestedPanelId?: string) => {
    const current = workspacePanelsRef.current;
    const panelIndex = requestedPanelId
      ? current.findIndex((panel) => panel.id === requestedPanelId)
      : current.findIndex((panel) => panel.tabIds.includes(serviceId));
    if (panelIndex < 0) return;
    const panel = current[panelIndex];
    const tabIndex = panel.tabIds.indexOf(serviceId);
    const remainingTabs = panel.tabIds.filter((id) => id !== serviceId);
    let next: WorkspacePanel[];
    let nextFocus: { panelId: string; serviceId: string } | null = null;
    const closingFocusedTab =
      focusedPanelIdRef.current === panel.id && selectedIdRef.current === serviceId;
    if (remainingTabs.length === 0) {
      next = current.filter((candidate) => candidate.id !== panel.id);
      const adjacent = next[Math.min(panelIndex, next.length - 1)];
      if (closingFocusedTab && adjacent) {
        nextFocus = { panelId: adjacent.id, serviceId: adjacent.activeTabId };
      }
    } else {
      const activeTabId = panel.activeTabId === serviceId
        ? remainingTabs[Math.min(tabIndex, remainingTabs.length - 1)]
        : panel.activeTabId;
      next = current.map((candidate) =>
        candidate.id === panel.id ? { ...candidate, tabIds: remainingTabs, activeTabId } : candidate
      );
      if (closingFocusedTab) nextFocus = { panelId: panel.id, serviceId: activeTabId };
    }
    workspacePanelsRef.current = next;
    setWorkspacePanels(next);
    if (closingFocusedTab) {
      setFocusedPanelId(nextFocus?.panelId ?? null);
      setSelectedId(nextFocus?.serviceId ?? null);
    }
  }, []);

  useEffect(() => {
    servicesRef.current = services;
  }, [services]);

  useEffect(() => {
    actualPortsRef.current = actualPorts;
  }, [actualPorts]);

  useEffect(() => {
    invoke<AppSettings>("load_settings")
      .then((loaded) => {
        setSettings(loaded);
        setSettingsLoaded(true);
        startupMark("settings loaded");
      })
      .catch(() => {
        setStartupError("Muxly could not load your settings. Check settings.json and reload.");
      });
  }, []);

  // Keep the ref synced with the live settings so closures captured by the
  // long-lived event listeners always see the latest user-tunable values.
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const persistSettings = useCallback(
    async (nextSettings: AppSettings) => {
      const previousSettings = settingsRef.current;
      settingsRef.current = nextSettings;
      setSettings(nextSettings);

      const save = settingsWriteQueueRef.current
        .catch(() => {
          /* a failed write must not prevent the next queued save */
        })
        .then(() => invoke<AppSettings>("save_settings", { settings: nextSettings }));

      const tracked = save.then(
        (saved) => {
          // A later queued update already contains this change. Do not replace
          // that optimistic state with an older backend response.
          if (settingsRef.current === nextSettings) {
            settingsRef.current = saved;
            setSettings(saved);
          }
          return saved;
        },
        (error) => {
          if (settingsRef.current === nextSettings) {
            settingsRef.current = previousSettings;
            setSettings(previousSettings);
          }
          throw error;
        }
      );

      settingsWriteQueueRef.current = tracked.then(
        () => undefined,
        () => undefined
      );
      return tracked;
    },
    []
  );

  useEffect(() => {
    // Services can finish loading before settings. Never persist aliases from
    // DEFAULT_SETTINGS during that gap, since doing so would overwrite saved
    // profiles and every other preference with their empty defaults.
    if (!settingsLoaded || sameAliases(settings.projectNameAliases, projectNameAliases)) {
      return;
    }

    void persistSettings({ ...settings, projectNameAliases }).catch((error) => {
      // Background alias-sync — surface to the dev console rather than the UI;
      // the user didn't initiate this and there's no obvious place to display it.
      console.warn("Failed to persist project name aliases:", errorMessage(error));
    });
  }, [persistSettings, projectNameAliases, settings, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded || !servicesLoaded) return;

    // Older or previously damaged settings can lose the managed profile
    // registry while services.json still contains valid profile assignments.
    // Recover those orphaned ids so the profile picker and assignments remain
    // usable instead of silently hiding the entire workflow.
    const current = settingsRef.current;
    const knownIds = new Set(current.profiles.map((profile) => profile.id));
    const missingIds = Array.from(
      new Set(
        services
          .map((service) => service.profile?.trim() ?? "")
          .filter((profileId) => profileId && !knownIds.has(profileId))
      )
    );
    if (missingIds.length === 0) return;

    void persistSettings({
      ...current,
      profiles: [
        ...current.profiles,
        ...missingIds.map((profileId) => ({ id: profileId, name: profileId }))
      ]
    })
      .then(() => {
        setManagerMessage(
          `Recovered ${missingIds.length} profile${missingIds.length === 1 ? "" : "s"} from service assignments`
        );
      })
      .catch((error) => {
        console.warn("Failed to recover service profiles:", errorMessage(error));
      });
  }, [persistSettings, services, servicesLoaded, settingsLoaded]);

  // Switch the active profile (null = "All profiles"), persisted in settings.
  const setActiveProfile = useCallback(
    (profileId: string | null) => {
      void persistSettings({ ...settingsRef.current, activeProfile: profileId }).catch(
        (error) => {
          console.warn("Failed to switch profile:", errorMessage(error));
        }
      );
    },
    [persistSettings]
  );

  const cycleProfile = useCallback(() => {
    const current = settingsRef.current;
    const ids: Array<string | null> = [null, ...current.profiles.map((profile) => profile.id)];
    if (ids.length <= 1) return;
    const index = ids.findIndex((id) => id === (current.activeProfile ?? null));
    const next = ids[(index + 1 + ids.length) % ids.length] ?? null;
    setActiveProfile(next);
    const label = current.profiles.find((profile) => profile.id === next)?.name ?? "All profiles";
    setManagerMessage(`Profile: ${label}`);
  }, [setActiveProfile]);

  // Create a profile by name and switch to it. Powers the command-palette quick
  // add; Settings has the fuller create/rename/delete UI. Name uniqueness is
  // case-insensitive, matching the Settings check.
  const createProfile = useCallback(
    async (rawName: string) => {
      const name = rawName.trim();
      if (!name) return;
      const current = settingsRef.current;
      if (
        current.profiles.some(
          (profile) => profile.name.trim().toLowerCase() === name.toLowerCase()
        )
      ) {
        throw new Error(`A profile named "${name}" already exists.`);
      }
      const id = crypto.randomUUID();
      await persistSettings({
        ...current,
        profiles: [...current.profiles, { id, name }],
        activeProfile: id
      });
    },
    [persistSettings]
  );

  // Count of running/starting services hidden by the active profile, surfaced
  // in the sidebar so a live-but-hidden service doesn't become a mystery.
  const runningElsewhere = useMemo(() => {
    if (!activeProfile) return [];
    return services.filter(
      (service) =>
        !isServiceInProfile(service, activeProfile) &&
        (["running", "starting", "restarting"] as ServiceStatus[]).includes(
          statuses[service.id]
        )
    );
  }, [services, activeProfile, statuses]);

  const profileActivity = useMemo(() => {
    const byProfile: Record<string, number> = {};
    const profileIds = new Set(settings.profiles.map((profile) => profile.id));
    let global = 0;
    for (const service of services) {
      if (!(["running", "starting", "restarting"] as ServiceStatus[]).includes(statuses[service.id])) {
        continue;
      }
      const profileId = service.profile?.trim();
      if (profileId && profileIds.has(profileId)) {
        byProfile[profileId] = (byProfile[profileId] ?? 0) + 1;
      } else {
        global += 1;
      }
    }
    return { global, byProfile };
  }, [services, settings.profiles, statuses]);

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
    const started = performance.now();
    const probes = await Promise.all(
      servicesToScan
        // Auto-port services roll off a busy port by design, so a taken
        // preferred port isn't a conflict worth flagging.
        .filter((service) => service.port != null && !service.autoPort)
        .map(async (service) => {
          try {
            const available = await runPortCheck(() => invoke<boolean>("check_port", { port: service.port }));
            return [service.id, !available] as const;
          } catch {
            return [service.id, false] as const;
          }
        })
    );
    startupMark("port diagnostics", performance.now() - started);
    setPortConflicts((current) => {
      const next = { ...current };
      for (const [id, conflict] of probes) next[id] = conflict;
      return next;
    });
  }, []);

  const runtimeRequestRef = useRef(0);
  const scanRuntimeRequirements = useCallback(async (servicesToScan: ServiceConfig[]) => {
    const request = ++runtimeRequestRef.current;
    const started = performance.now();
    const report = await runRuntimeCheck(() => invoke<RuntimeRequirementReport>("check_runtime_requirements", {
      services: servicesToScan
    }));
    startupMark("runtime diagnostics", performance.now() - started);
    if (request !== runtimeRequestRef.current) return report;
    setRuntimeReport(report);
    setRuntimeWarningOpen(report.issues.length > 0);
    return report;
  }, []);

  const activateRuntimeFallback = useCallback(
    async (path: string) => {
      await invoke("activate_runtime_fallback", { path });
      await scanRuntimeRequirements(servicesRef.current);
    },
    [scanRuntimeRequirements]
  );

  const reloadServices = useCallback(async () => {
    try {
      const { services: loaded, problems } =
        await invoke<LoadedServices>("load_services");
      setServices(loaded);
      setStatuses((current) => {
        const next: Record<string, ServiceStatus> = {};
        for (const service of loaded) {
          next[service.id] = current[service.id] ?? "stopped";
        }
        return next;
      });
      if (problems.length > 0) {
        // Some entries were skipped (malformed/invalid/duplicate). Keep the
        // loaded ones working and surface what was dropped — the full list is
        // available on hover since the status line is clamped to two lines.
        const summary = problems.length === 1 ? "1 entry skipped" : `${problems.length} entries skipped`;
        setManagerMessage(`Loaded ${loaded.length} services — ${summary}: ${problems.join("; ")}`);
      } else {
        setManagerMessage(
          loaded.length > 0 ? `Loaded ${loaded.length} services` : "No services configured yet"
        );
      }
      return loaded;
    } catch (error) {
      setManagerMessage(errorMessage(error));
      throw error;
    }
  }, []);

  useEffect(() => {
    reloadServices()
      .then(() => {
        setServicesLoaded(true);
        startupMark("services loaded");
      })
      .catch(() => {
        setStartupError("Muxly could not load your services. Check services.json and reload.");
      });
  }, [reloadServices]);

  useEffect(() => {
    if (!workspaceReady) return;
    // A task boundary lets the workspace commit before optional diagnostics.
    const timer = window.setTimeout(() => {
      void scanPorts(servicesRef.current);
      void scanRuntimeRequirements(servicesRef.current).catch((error) => {
        console.warn("Failed to check runtime requirements:", errorMessage(error));
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [workspaceReady, scanPorts, scanRuntimeRequirements]);

  useEffect(() => {
    if (!settingsLoaded || !servicesLoaded || workspaceRestoredRef.current) return;
    const validIds = new Set(services.map((service) => service.id));
    let panels = (settings.workspacePanels ?? [])
      .map((panel) => {
        const tabIds = panel.tabIds.filter((id) => validIds.has(id));
        return {
          ...panel,
          tabIds,
          activeTabId: tabIds.includes(panel.activeTabId) ? panel.activeTabId : tabIds[0] ?? ""
        };
      })
      .filter((panel) => panel.tabIds.length > 0);
    if (panels.length === 0) {
      const restored = (settings.openPaneIds ?? []).filter((id) => validIds.has(id));
      const splitIds = (settings.splitPaneIds ?? []).filter((id) => validIds.has(id));
      if (splitIds.length > 0) {
        panels = splitIds.map((id) => ({ id: crypto.randomUUID(), tabIds: [id], activeTabId: id }));
        const remaining = restored.filter((id) => !splitIds.includes(id));
        if (remaining.length > 0) {
          const target = panels.find((panel) => panel.activeTabId === settings.focusedPaneId) ?? panels[0];
          target.tabIds.push(...remaining);
        }
      } else if (restored.length > 0) {
        const activeTabId = settings.focusedPaneId && restored.includes(settings.focusedPaneId)
          ? settings.focusedPaneId
          : restored[0];
        panels = [{ id: crypto.randomUUID(), tabIds: restored, activeTabId }];
      } else if (services[0]) {
        panels = [{ id: crypto.randomUUID(), tabIds: [services[0].id], activeTabId: services[0].id }];
      }
    }
    const focusedPanel = panels.find((panel) => panel.id === settings.focusedPanelId)
      ?? panels.find((panel) => panel.activeTabId === settings.focusedPaneId)
      ?? panels[0]
      ?? null;
    workspaceRestoredRef.current = true;
    setWorkspaceReady(true);
    workspacePanelsRef.current = panels;
    setWorkspacePanels(panels);
    setFocusedPanelId(focusedPanel?.id ?? null);
    setSelectedId(focusedPanel?.activeTabId ?? null);
  }, [services, servicesLoaded, settings.focusedPaneId, settings.focusedPanelId, settings.openPaneIds, settings.splitPaneIds, settings.workspacePanels, settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded || settings.openServicesInTabs) return;
    setWorkspacePanels((current) => {
      const next = current.map((panel) => ({
        ...panel,
        tabIds: [panel.activeTabId]
      }));
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [settings.openServicesInTabs, settingsLoaded]);

  // Live services.json edits and in-app deletion can invalidate restored tabs.
  // Keep the runtime workspace normalized after the one-time startup restore so
  // a removed service cannot leave a blank panel or an invalid active tab that
  // is then persisted back to settings.
  useEffect(() => {
    if (!workspaceRestoredRef.current) return;
    const validIds = new Set(services.map((service) => service.id));
    const current = workspacePanelsRef.current;
    const next = current
      .map((panel) => {
        const tabIds = panel.tabIds.filter((id) => validIds.has(id));
        return {
          ...panel,
          tabIds,
          activeTabId: tabIds.includes(panel.activeTabId) ? panel.activeTabId : tabIds[0] ?? ""
        };
      })
      .filter((panel) => panel.tabIds.length > 0);

    if (JSON.stringify(next) === JSON.stringify(current)) return;

    const focusedPanel =
      next.find((panel) => panel.id === focusedPanelIdRef.current) ?? next[0] ?? null;
    workspacePanelsRef.current = next;
    setWorkspacePanels(next);
    setFocusedPanelId(focusedPanel?.id ?? null);
    setSelectedId(focusedPanel?.activeTabId ?? null);
    setSearchPaneId((serviceId) => (serviceId && validIds.has(serviceId) ? serviceId : null));
    setPaneSearchSeed((seed) => (seed && validIds.has(seed.serviceId) ? seed : null));
  }, [services]);

  useEffect(() => {
    if (!workspaceRestoredRef.current) return;
    const samePanels = JSON.stringify(settings.workspacePanels ?? []) === JSON.stringify(workspacePanels);
    if (samePanels && (settings.focusedPanelId ?? null) === focusedPanelId && (settings.focusedPaneId ?? null) === selectedId) return;
    const timer = window.setTimeout(() => {
      void persistSettings({
        ...settingsRef.current,
        openPaneIds: paneIds,
        focusedPaneId: selectedId,
        splitPaneIds: workspacePanels.map((panel) => panel.activeTabId),
        workspacePanels,
        focusedPanelId
      }).catch((error) => {
        console.warn("Failed to persist workspace:", errorMessage(error));
      });
    }, 150);
    return () => window.clearTimeout(timer);
  }, [focusedPanelId, paneIds, persistSettings, selectedId, settings.focusedPaneId, settings.focusedPanelId, settings.workspacePanels, workspacePanels]);

  // External edits to services.json (agent, script, editor) reload live.
  useEffect(() => {
    const unlisten = listen(SERVICES_CHANGED, () => {
      reloadServices()
        .then((loaded) => {
          void scanPorts(loaded);
          void scanRuntimeRequirements(loaded).catch((error) => {
            console.warn("Failed to check runtime requirements:", errorMessage(error));
          });
        })
        .catch(() => {
          /* error already surfaced in managerMessage */
        });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [reloadServices, scanPorts, scanRuntimeRequirements]);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let disposed = false;

    function trackUnlisten(promise: Promise<() => void>) {
      void promise.then((unlisten) => {
        if (disposed) {
          unlisten();
          return;
        }
        unlisteners.push(unlisten);
      });
    }

    trackUnlisten(listen<ProcessStartedEvent>(PROCESS_STARTED, (event) => {
      const { serviceId, pid, runToken, port } = event.payload;
      activeRunTokensRef.current[serviceId] = runToken;
      setStatuses((current) => ({ ...current, [serviceId]: "running" }));
      setPids((current) => ({ ...current, [serviceId]: pid }));
      // Record the port the process actually bound to, and note when auto-port
      // had to roll off the preferred one so the collision is visible.
      if (port != null) {
        setActualPorts((current) => ({ ...current, [serviceId]: port }));
        const service = servicesRef.current.find((s) => s.id === serviceId);
        if (service?.autoPort && service.port != null && service.port !== port) {
          appendLog(
            serviceId,
            `\r\n\x1b[33m[manager] port ${service.port} busy — using ${port} instead\x1b[0m\r\n`
          );
        }
      }
      // The port (if any) now belongs to this service; clear any stale conflict.
      setPortConflicts((current) =>
        current[serviceId] ? { ...current, [serviceId]: false } : current
      );
      // Our process is now the live owner — any "blocker" / "adopted"
      // bookkeeping from before is obsolete and must not stick around.
      setPortBlockers((current) => {
        if (!current[serviceId]) return current;
        const next = { ...current };
        delete next[serviceId];
        return next;
      });
      setAdoptedPids((current) => {
        if (!current[serviceId]) return current;
        const next = { ...current };
        delete next[serviceId];
        return next;
      });
      appendLog(serviceId, `\r\n\x1b[36m[manager] started pid ${pid}\x1b[0m\r\n`);
      refreshHistory(serviceId);

      // Consume the user-start flag on every start (PTY or not) so it can't
      // linger or arm the hint on an unrelated later spawn. Only PTY starts
      // actually use it below.
      const userStarted = userStartedRef.current.delete(serviceId);
      // A fresh user start clears any prior slow/stuck notice — the new attempt
      // starts clean. Automatic recycles keep it (they're the same struggle).
      if (userStarted) {
        clearStartHealth(serviceId);
      }

      // Arm the fallback watchdog for portless PTY services. The backend
      // handles ConPTY's cursor handshake directly; this only covers unrelated
      // launchers that remain completely silent. Pipe-mode spawns don't use it.
      const startedService = servicesRef.current.find((s) => s.id === serviceId);
      if (startedService?.usePty) {
        // The backend opens every PTY at a default 120×30 (it can't know the
        // pane size until the child exists). The pane already fitted xterm to
        // its real, narrower geometry on mount, but that resize was a no-op
        // because the process wasn't running yet — and nothing fires the pane's
        // ResizeObserver afterwards since its box never changes. Re-push the
        // measured size now so the PTY's width matches xterm's. Without this the
        // two disagree and readline-driven REPLs (node, python) compute their
        // cursor-relative redraws against the wrong width, landing echoed input
        // on the wrong row.
        const terminal = terminalsRef.current.get(serviceId);
        if (terminal && terminal.cols > 0 && terminal.rows > 0) {
          void invoke("service_pty_resize", {
            serviceId,
            cols: terminal.cols,
            rows: terminal.rows
          }).catch(() => {
            /* race with a stop — the next real resize will resync */
          });
        }

        // One-shot "waiting for output…" hint. Only a user-initiated Start/
        // Restart arms it (userStarted, captured above); automatic recycles/
        // auto-restarts don't, so it never re-appears on its own. It hides on
        // the first real output or after WAITING_FOR_OUTPUT_MAX_MS, whichever
        // comes first.
        const alreadySawOutput = sawPtyOutputRef.current[serviceId] === runToken;
        if (userStarted && !alreadySawOutput) {
          if (awaitingTimersRef.current[serviceId] !== undefined) {
            window.clearTimeout(awaitingTimersRef.current[serviceId]);
          }
          setAwaitingOutput((current) =>
            current[serviceId] ? current : { ...current, [serviceId]: true }
          );
          awaitingTimersRef.current[serviceId] = window.setTimeout(() => {
            delete awaitingTimersRef.current[serviceId];
            setAwaitingOutput((current) =>
              current[serviceId] ? { ...current, [serviceId]: false } : current
            );
          }, WAITING_FOR_OUTPUT_MAX_MS);
        }

        const watchedToken = runToken;
        ptyDebug(serviceId, "watchdog armed", { runToken, pid, windowMs: PTY_WATCHDOG_MS });
        window.setTimeout(() => {
          maybeRecyclePtyStart(serviceId, watchedToken);
        }, PTY_WATCHDOG_MS);
      }
    }));

    trackUnlisten(listen<ProcessExitedEvent>(PROCESS_EXITED, (event) => {
      const { serviceId, runToken, code, signal, requested } = event.payload;
      if (activeRunTokensRef.current[serviceId] !== runToken) {
        return;
      }
      delete activeRunTokensRef.current[serviceId];
      delete outputChannelsRef.current[serviceId];
      const nextStatus: ServiceStatus = requested
        ? "stopped"
        : code === 0 && signal === null
        ? "exited"
        : "failed";
      setStatuses((current) => ({ ...current, [serviceId]: nextStatus }));
      clearAwaitingOutput(serviceId);
      // A genuine stop clears the slow/stuck notice. An in-flight recycle or
      // user-restart (pendingRestart) keeps it — the respawn's user-start or its
      // eventual output clears it instead, so the notice doesn't flicker.
      if (!pendingRestartRef.current.has(serviceId)) {
        clearStartHealth(serviceId);
      }
      setPids((current) => {
        const next = { ...current };
        delete next[serviceId];
        return next;
      });
      setActualPorts((current) => {
        if (current[serviceId] == null) return current;
        const next = { ...current };
        delete next[serviceId];
        return next;
      });
      setLastExit((current) => ({
        ...current,
        [serviceId]: shortExitCode(code, requested, signal)
      }));
      const description = describeExitCode(code, requested, signal);
      // Failed exits get a red banner so a decoded NTSTATUS reads as the
      // diagnostic it is, rather than getting lost in the same cyan colour
      // we use for routine lifecycle events ("starting", "stopped").
      // A signal death is an error too — it has no exit code, so the numeric
      // check alone would colour a SIGSEGV the same calm cyan as a clean stop.
      const isError = !requested && (signal !== null || (code !== 0 && code !== null));
      const colour = isError ? "\x1b[31m" : "\x1b[36m";
      appendLog(
        serviceId,
        `\r\n${colour}[manager] process exited (${description})\x1b[0m\r\n`
      );
      // Re-probe the port after a short delay so the OS has time to release it.
      scheduleRescan(serviceId);

      refreshHistory(serviceId);

      if (pendingRestartRef.current.has(serviceId)) {
        // The user asked to restart a running service: we stopped it, and now
        // that its exit has landed we re-spawn it regardless of exit code. A
        // deliberate cycle, so it doesn't count against the crash budget.
        pendingRestartRef.current.delete(serviceId);
        delete autoRestartRef.current[serviceId];
        const service = servicesRef.current.find((s) => s.id === serviceId);
        if (service) {
          window.setTimeout(() => {
            void startServiceRef.current(service);
          }, AUTO_RESTART_DELAY_MS);
        }
      } else if (!requested) {
        // Any exit the user didn't ask for is a candidate for auto-restart —
        // including a *clean* `code 0`. Dev servers behind a nested orchestrator
        // (Tauri's `tauri:dev`, `bun run dev → wxt → node`, etc.) re-pipe their
        // inner Vite's stdio, so a PTY on the parent never reaches it; Vite then
        // drains its event loop after an HMR cycle and exits 0. Treating only
        // non-zero exits as restartable would leave those silently dead. The
        // per-service `autoRestart` opt-in and the attempt budget (checked in
        // `maybeAutoRestart`) keep a genuinely-finishing task from looping.
        maybeAutoRestart(serviceId);
      } else {
        // User-requested stop — reset the crash budget.
        delete autoRestartRef.current[serviceId];
      }

      // Abnormal exit + a configured port still held by *someone else* =
      // likely "another instance is already running" (Next, Vite,
      // `vite preview`, etc.). Resolve the holder and surface the banner
      // so the user can stop-and-restart or adopt without leaving the app.
      const service = servicesRef.current.find((s) => s.id === serviceId);
      const abnormal = !requested && (signal !== null || code === null || code !== 0);
      // Auto-port services can't fail *because* the preferred port was taken —
      // Muxly would have rolled to a free one — so skip the blocker probe.
      if (abnormal && service && service.port != null && !service.autoPort) {
        const port = service.port;
        // Tiny delay so we re-probe after the OS has had a moment to settle
        // — without it, our own freshly-released listener can briefly
        // re-bind and we'd report ourselves as the blocker.
        window.setTimeout(() => {
          invoke<number | null>("find_port_holder", { port })
            .then((pid) => {
              if (!pid) return;
              setPortBlockers((current) => ({
                ...current,
                [serviceId]: { pid, port }
              }));
            })
            .catch(() => {
              /* No netstat/lsof available — silent fallback. */
          });
        }, 400);
      }
    }));

    trackUnlisten(listen<ProcessFailedEvent>(PROCESS_FAILED, (event) => {
      const { serviceId, runToken, message } = event.payload;
      if (activeRunTokensRef.current[serviceId] !== runToken) {
        return;
      }
      delete activeRunTokensRef.current[serviceId];
      delete outputChannelsRef.current[serviceId];
      setStatuses((current) => ({ ...current, [serviceId]: "failed" }));
      clearAwaitingOutput(serviceId);
      clearStartHealth(serviceId);
      appendLog(serviceId, `\r\n\x1b[31m[manager] ${message}\x1b[0m\r\n`);
      scheduleRescan(serviceId);
      refreshHistory(serviceId);
    }));

    function scheduleRescan(serviceId: string) {
      const service = servicesRef.current.find((s) => s.id === serviceId);
      if (!service || service.port == null) return;
      window.setTimeout(() => void scanPorts([service]), 300);
    }

    // Last-resort recovery for a portless PTY start that produced no output.
    // Kill it and let the exit handler respawn it against a fresh terminal,
    // capped so a genuinely silent tool cannot loop forever.
    function maybeRecyclePtyStart(serviceId: string, token: number) {
      // Only the still-live run that never emitted output is a candidate.
      if (activeRunTokensRef.current[serviceId] !== token) {
        ptyDebug(serviceId, "watchdog skip: a newer run replaced this one", {
          token,
          active: activeRunTokensRef.current[serviceId]
        });
        return;
      }
      if (sawPtyOutputRef.current[serviceId] === token) {
        ptyDebug(serviceId, "watchdog skip: real (newline) output seen → healthy", { token });
        return;
      }
      const service = servicesRef.current.find((s) => s.id === serviceId);
      if (!service) return;

      // The one-shot "waiting…" hint is done — escalate to a visible notice.
      clearAwaitingOutput(serviceId);

      const effectivePort = actualPortsRef.current[serviceId] ?? service.port ?? null;
      if (effectivePort != null || service.autoPort) {
        ptyDebug(serviceId, "watchdog: no output but service has a port — informing, not recycling", {
          token,
          port: effectivePort
        });
        setStartHealth((current) => ({
          ...current,
          [serviceId]: { kind: "waiting-port", port: effectivePort }
        }));
        return;
      }

      // Off Windows there is no ConPTY deadlock to recover from: a Unix pty
      // either spawned the child or failed outright. Silence here means the
      // service is simply quiet — a file watcher, a queue worker, anything that
      // logs nothing until it has something to say — and killing it would be
      // destroying a healthy process on no evidence. Report and stop.
      if (!isWindows) {
        ptyDebug(serviceId, "watchdog: portless and quiet, but not Windows — informing, not recycling", {
          token
        });
        setStartHealth((current) => ({ ...current, [serviceId]: { kind: "quiet" } }));
        return;
      }

      // Portless: output is the only signal we have, so keep the narrow ConPTY-
      // deadlock recovery — kill + respawn on a fresh ConPTY (the race usually
      // wins on the next try), capped so a truly silent tool can't loop forever.
      const attempts = (ptyRecycleRef.current[serviceId] ?? 0) + 1;
      ptyDebug(serviceId, "watchdog fired: portless, no output — recycling", {
        token,
        attempt: attempts,
        max: PTY_RECYCLE_MAX
      });
      if (attempts > PTY_RECYCLE_MAX) {
        appendLog(
          serviceId,
          `\r\n\x1b[31m[manager] start still produced no output after ${PTY_RECYCLE_MAX} recycles — leaving it; press restart to try again\x1b[0m\r\n`
        );
        delete ptyRecycleRef.current[serviceId];
        setStartHealth((current) => ({
          ...current,
          [serviceId]: { kind: "stuck", max: PTY_RECYCLE_MAX }
        }));
        return;
      }
      ptyRecycleRef.current[serviceId] = attempts;
      setStartHealth((current) => ({
        ...current,
        [serviceId]: { kind: "retrying", attempt: attempts, max: PTY_RECYCLE_MAX }
      }));
      appendLog(
        serviceId,
        `\r\n\x1b[33m[manager] no output in ${Math.round(
          PTY_WATCHDOG_MS / 1000
        )}s — PTY start likely stuck, recycling (attempt ${attempts}/${PTY_RECYCLE_MAX})\x1b[0m\r\n`
      );
      // Reuse the restart handoff: stop the stuck child; the exit handler sees
      // the pending-restart flag and re-spawns it (fresh ConPTY) after a beat.
      pendingRestartRef.current.add(serviceId);
      void invoke("stop_service", { serviceId }).catch((error) => {
        pendingRestartRef.current.delete(serviceId);
        appendLog(serviceId, `\r\n\x1b[31m[manager] ${errorMessage(error)}\x1b[0m\r\n`);
      });
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
      setStatuses((current) => ({ ...current, [serviceId]: "restarting" }));
      window.setTimeout(() => {
        void startServiceRef.current(service);
      }, AUTO_RESTART_DELAY_MS);
    }

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
      for (const pending of pendingPtyCarriageReturnsRef.current.values()) {
        window.clearTimeout(pending.timer);
      }
      pendingPtyCarriageReturnsRef.current.clear();
      for (const timer of Object.values(awaitingTimersRef.current)) {
        window.clearTimeout(timer);
      }
      awaitingTimersRef.current = {};
    };
  }, []);

  // Drain the per-service buffers, writing each terminal's accumulated output
  // in a single `write()`. Runs once per frame (scheduled from appendLog).
  const flushTerminalWrites = useCallback(() => {
    flushRafRef.current = 0;
    const pending = pendingWritesRef.current;
    if (pending.size === 0) return;
    for (const [serviceId, data] of pending) {
      // The pane may have closed between buffering and this flush — its
      // terminal is gone from the registry, so the write simply no-ops and
      // the output survives in logsRef for the next time the pane opens.
      terminalsRef.current.get(serviceId)?.write(data);
    }
    pending.clear();
  }, []);

  const enqueueTerminalWrite = useCallback(
    (serviceId: string, data: string) => {
      if (!terminalsRef.current.has(serviceId)) return;

      const pending = pendingWritesRef.current;
      pending.set(serviceId, (pending.get(serviceId) ?? "") + data);
      if (flushRafRef.current === 0) {
        flushRafRef.current = requestAnimationFrame(flushTerminalWrites);
      }
    },
    [flushTerminalWrites]
  );

  const takePendingPtyCarriageReturn = useCallback((serviceId: string) => {
    const pending = pendingPtyCarriageReturnsRef.current.get(serviceId);
    if (!pending) return "";

    window.clearTimeout(pending.timer);
    pendingPtyCarriageReturnsRef.current.delete(serviceId);
    return pending.text;
  }, []);

  const enqueueLiveTerminalWrite = useCallback(
    (serviceId: string, data: string, isPty: boolean) => {
      if (!terminalsRef.current.has(serviceId)) {
        takePendingPtyCarriageReturn(serviceId);
        return;
      }

      // Windows only: ConPTY splits a readline redraw into a bare carriage
      // return and a later repaint, and painting the gap shows as a cursor
      // flicker at column 0. Unix ptys deliver the redraw in one piece, so the
      // hold buys nothing there and only delays every spinner and progress-bar
      // frame by the settle interval.
      if (isWindows && isPty && data === "\r") {
        const current = takePendingPtyCarriageReturn(serviceId);
        const text = current + data;
        const timer = window.setTimeout(() => {
          pendingPtyCarriageReturnsRef.current.delete(serviceId);
          enqueueTerminalWrite(serviceId, text);
        }, PTY_CARRIAGE_RETURN_SETTLE_MS);

        pendingPtyCarriageReturnsRef.current.set(serviceId, { text, timer });
        return;
      }

      enqueueTerminalWrite(serviceId, takePendingPtyCarriageReturn(serviceId) + data);
    },
    [enqueueTerminalWrite, takePendingPtyCarriageReturn]
  );

  const appendLog = useCallback((serviceId: string, chunk: string) => {
    // Apply the [HH:MM:SS] annotation *before* the chunk lands in the
    // in-memory buffer so the replay on pane mount renders with the same
    // marks the live terminal saw — the buffer is the source of truth.
    //
    // PTY services are exempt: their output carries cursor-addressing and
    // clear-screen escapes (spinners, progress bars, interactive prompts), and
    // injecting timestamps mid-stream would land between escape sequences and
    // corrupt the rendering. We take their output verbatim.
    const service = servicesRef.current.find((s) => s.id === serviceId);
    const isPty = service?.usePty ?? false;
    const annotated =
      settingsRef.current.showTimestamps && !isPty
        ? annotateChunkWithTimestamps(serviceId, chunk, lineStateRef.current)
        : chunk;

    const chunks = logsRef.current[serviceId] ?? [];
    chunks.push(annotated);

    const limit = settingsRef.current.maxLogChunks;
    if (chunks.length > limit) {
      chunks.splice(0, chunks.length - limit);
    }

    logsRef.current[serviceId] = chunks;
    logRevisionsRef.current[serviceId] = (logRevisionsRef.current[serviceId] ?? 0) + 1;
    // The buffer above keeps raw output (the source of truth); redaction is a
    // display-only transform applied to the live write, so toggling stream mode
    // off and reopening the pane shows real paths again. Mirrors how name
    // masking is applied at display time, not stored.
    const display =
      service && streamModeRef.current
        ? redactSensitive(
            annotated,
            service,
            projectNameAliasesRef.current[groupKey(service)] ?? "",
            true
          )
        : annotated;
    // Buffer the live write and flush it next frame (see pendingWritesRef).
    // Only buffer when a pane is actually showing this service; otherwise the
    // pane-mount replay from logsRef already covers it, and buffering here
    // could double-render against that replay. Registration in TerminalPanes
    // happens after the replay, so a present terminal means replay is done.
    enqueueLiveTerminalWrite(serviceId, display, isPty);
  }, [enqueueLiveTerminalWrite]);

  // Hide the "waiting for output…" hint for a service and cancel its pending
  // hide-timer. Idempotent — safe to call on output, exit, failure, or unmount.
  const clearAwaitingOutput = useCallback((serviceId: string) => {
    const timer = awaitingTimersRef.current[serviceId];
    if (timer !== undefined) {
      window.clearTimeout(timer);
      delete awaitingTimersRef.current[serviceId];
    }
    setAwaitingOutput((current) =>
      current[serviceId] ? { ...current, [serviceId]: false } : current
    );
  }, []);

  // Drop any slow/stuck start-health notice for a service.
  const clearStartHealth = useCallback((serviceId: string) => {
    setStartHealth((current) => {
      if (!current[serviceId]) return current;
      const next = { ...current };
      delete next[serviceId];
      return next;
    });
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
        const { serviceId, runToken, stream, chunk } = msg;
        const activeRunToken = activeRunTokensRef.current[serviceId];
        if (activeRunToken != null && activeRunToken !== runToken) {
          return;
        }
        // ConPTY emits its own init burst (an OSC set-title plus cursor
        // show/hide escapes) before the child runs, and none of it carries a
        // newline. Only real *line* output proves the child actually came up,
        // so gate the watchdog signal on a newline — otherwise that boilerplate
        // masks a deadlocked start as "alive" and the recycle retry never
        // fires. appendLog still runs for every chunk, so rendering is
        // unaffected; only the "saw output" / recycle-budget signals are gated.
        const accepted = sawPtyOutputRef.current[serviceId] === runToken;
        if (!accepted) {
          // Trace only the startup window (until this run is accepted): this is
          // exactly where ConPTY's newline-free init burst shows up on a stuck
          // start. Goes quiet once real output lands, so it never floods.
          ptyDebug(serviceId, "startup chunk", {
            runToken,
            stream,
            bytes: chunk.length,
            hasNewline: chunk.includes("\n"),
            preview: JSON.stringify(chunk.slice(0, 80))
          });
        }
        if (chunk.includes("\n")) {
          if (!accepted) {
            ptyDebug(serviceId, "accepted: first newline output → watchdog disarmed", {
              runToken
            });
            // First real output — drop the "waiting for output…" hint and any
            // slow/stuck notice (the start recovered).
            clearAwaitingOutput(serviceId);
            clearStartHealth(serviceId);
          }
          sawPtyOutputRef.current[serviceId] = runToken;
          delete ptyRecycleRef.current[serviceId];
        }
        appendLog(serviceId, stream === "stderr" ? `\x1b[31m${chunk}\x1b[0m` : chunk);
      };
      outputChannelsRef.current[service.id] = onOutput;

      try {
        await invoke("start_service", { service, onOutput });
      } catch (error) {
        delete outputChannelsRef.current[service.id];
        // The start never reached PROCESS_STARTED — drop the user-start flag so
        // it can't arm the hint on some unrelated later spawn, and hide any hint.
        userStartedRef.current.delete(service.id);
        clearAwaitingOutput(service.id);
        clearStartHealth(service.id);
        setStatuses((current) => ({ ...current, [service.id]: "failed" }));
        appendLog(service.id, `\r\n\x1b[31m[manager] ${errorMessage(error)}\x1b[0m\r\n`);
      }
    },
    [appendLog, statuses, clearAwaitingOutput, clearStartHealth]
  );

  useEffect(() => {
    startServiceRef.current = startService;
  }, [startService]);

  // A start triggered explicitly by the user. Clears the auto-restart budget so
  // a manual start after "gave up" gets a fresh set of retries, and flags this
  // start as user-initiated so the one-shot "waiting for output…" hint shows.
  const manualStart = useCallback(
    (service: ServiceConfig) => {
      delete autoRestartRef.current[service.id];
      userStartedRef.current.add(service.id);
      return startService(service);
    },
    [startService]
  );

  // Kill the foreign process holding our port, then re-spawn the service.
  // We clear the blocker eagerly so the banner disappears immediately — if
  // the kill actually failed, the start attempt below will fail and a fresh
  // blocker entry will repopulate from the exit handler.
  const stopBlockerAndRestart = useCallback(
    async (service: ServiceConfig) => {
      const blocker = portBlockers[service.id];
      if (!blocker) return;
      try {
        await invoke("kill_pid", { pid: blocker.pid });
        appendLog(
          service.id,
          `\r\n\x1b[36m[manager] stopped blocking process pid ${blocker.pid} on port ${blocker.port}\x1b[0m\r\n`
        );
        setPortBlockers((current) => {
          if (!current[service.id]) return current;
          const next = { ...current };
          delete next[service.id];
          return next;
        });
        // Give the OS a beat to release the listening socket before we try
        // to bind to it ourselves. Without this `next dev` (and friends)
        // often races us and re-reports the conflict.
        window.setTimeout(() => {
          void manualStart(service);
        }, 600);
      } catch (error) {
        appendLog(
          service.id,
          `\r\n\x1b[31m[manager] failed to stop pid ${blocker.pid}: ${errorMessage(
            error
          )}\x1b[0m\r\n`
        );
      }
    },
    // appendLog and manualStart are defined further down in this component;
    // they're stable across renders, so safe to omit. portBlockers needs to
    // be a dep so we read the latest blocker entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [portBlockers]
  );

  // Treat the external process holding our port as "this service is running".
  // We don't own its IO, but state, status colour, and the Open-URL button
  // all stop lying about what's actually live on the port.
  const adoptRunningInstance = useCallback(
    (service: ServiceConfig) => {
      const blocker = portBlockers[service.id];
      if (!blocker) return;
      setAdoptedPids((current) => ({ ...current, [service.id]: blocker }));
      setPortBlockers((current) => {
        const next = { ...current };
        delete next[service.id];
        return next;
      });
      appendLog(
        service.id,
        `\r\n\x1b[36m[manager] adopted external pid ${blocker.pid} on port ${blocker.port} (stdout/stderr not captured)\x1b[0m\r\n`
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [portBlockers]
  );

  // Drop the adoption mapping without killing the adopted process — used by
  // the "✕" affordance on the adopted badge. The service goes back to
  // looking exited, which is accurate.
  const releaseAdopted = useCallback((serviceId: string) => {
    setAdoptedPids((current) => {
      if (!current[serviceId]) return current;
      const next = { ...current };
      delete next[serviceId];
      return next;
    });
  }, []);

  // Reconcile every adopted entry against the live port holder every few
  // seconds. If the port is now free, or held by a different PID, the
  // adoption is stale and we drop it so the UI stops claiming the service
  // is running.
  useEffect(() => {
    const ids = Object.keys(adoptedPids);
    if (ids.length === 0) return;
    const handle = window.setInterval(() => {
      ids.forEach((serviceId) => {
        const entry = adoptedPids[serviceId];
        if (!entry) return;
        invoke<number | null>("find_port_holder", { port: entry.port })
          .then((pid) => {
            if (pid === entry.pid) return;
            setAdoptedPids((current) => {
              if (current[serviceId]?.pid !== entry.pid) return current;
              const next = { ...current };
              delete next[serviceId];
              return next;
            });
            appendLog(
              serviceId,
              `\r\n\x1b[33m[manager] adopted process pid ${entry.pid} is no longer listening on port ${entry.port}\x1b[0m\r\n`
            );
          })
          .catch(() => {
            /* keep adoption if we can't probe right now */
          });
      });
    }, 4_000);
    return () => window.clearInterval(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adoptedPids]);

  // Port-readiness probe. For a *server* (a service with a port), the port
  // becoming "listening" is a far more reliable "it started" signal than stdout
  // — a quiet server may never print anything. While such a service is running
  // but its current run hasn't been marked up yet, poll the port; once it
  // listens we treat the run as up: disarm the deadlock watchdog and clear the
  // start notices, without waiting on (or killing for the absence of) output.
  // The `sawPtyOutputRef` guard means we only announce for a run that came up
  // silently — a service that already printed output skips this entirely.
  useEffect(() => {
    const servers = services.filter(
      (service) =>
        statuses[service.id] === "running" &&
        (actualPorts[service.id] ?? service.port ?? null) != null
    );
    if (servers.length === 0) return;

    const probe = () => {
      servers.forEach((service) => {
        const token = activeRunTokensRef.current[service.id];
        if (token == null) return;
        if (sawPtyOutputRef.current[service.id] === token) return; // already up
        const port = actualPortsRef.current[service.id] ?? service.port ?? null;
        if (port == null) return;
        void invoke<boolean>("check_port", { port })
          .then((available) => {
            if (available) return; // nothing listening yet
            // Re-check ownership after the await — a stop/restart may have
            // landed in the meantime.
            if (activeRunTokensRef.current[service.id] !== token) return;
            if (sawPtyOutputRef.current[service.id] === token) return;
            sawPtyOutputRef.current[service.id] = token;
            delete ptyRecycleRef.current[service.id];
            clearAwaitingOutput(service.id);
            clearStartHealth(service.id);
            appendLog(
              service.id,
              `\r\n\x1b[36m[manager] port ${port} is listening — service is up\x1b[0m\r\n`
            );
          })
          .catch(() => {
            /* probe failed — try again next tick */
          });
      });
    };

    probe();
    const handle = window.setInterval(probe, 800);
    return () => window.clearInterval(handle);
  }, [services, statuses, actualPorts, appendLog, clearAwaitingOutput, clearStartHealth]);

  const stopService = useCallback(
    async (service: ServiceConfig) => {
      // Adopted services: route Stop to taskkill/kill on the foreign PID
      // rather than the (non-existent) one we spawned.
      const adopted = adoptedPids[service.id];
      if (adopted) {
        try {
          await invoke("kill_pid", { pid: adopted.pid });
          appendLog(
            service.id,
            `\r\n\x1b[36m[manager] killed adopted pid ${adopted.pid}\x1b[0m\r\n`
          );
          setAdoptedPids((current) => {
            if (!current[service.id]) return current;
            const next = { ...current };
            delete next[service.id];
            return next;
          });
          setStatuses((current) => ({ ...current, [service.id]: "stopped" }));
        } catch (error) {
          appendLog(
            service.id,
            `\r\n\x1b[31m[manager] failed to kill adopted pid ${adopted.pid}: ${errorMessage(
              error
            )}\x1b[0m\r\n`
          );
        }
        return;
      }

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
    [appendLog, pids, adoptedPids]
  );

  // The documented "restart" action (Ctrl/Cmd+R). Starting alone is a no-op
  // against a live process, so for a running service we stop it and let the
  // exit handler re-spawn it once the exit lands (see `pendingRestartRef`).
  // An adopted instance has no exit of ours to wait on, so we kill it and
  // start our own after the port frees. A stopped/failed/exited service just
  // starts. This is what lets restart cycle a service without the user having
  // to stop and start by hand.
  const restartService = useCallback(
    async (service: ServiceConfig) => {
      if (pids[service.id] != null) {
        // User-initiated: the respawn happens via the exit handler (not
        // manualStart), so flag it here for the "waiting for output…" hint.
        userStartedRef.current.add(service.id);
        pendingRestartRef.current.add(service.id);
        await stopService(service);
        return;
      }
      if (adoptedPids[service.id] != null) {
        await stopService(service);
        window.setTimeout(() => void manualStart(service), 600);
        return;
      }
      await manualStart(service);
    },
    [pids, adoptedPids, stopService, manualStart]
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

  // Toggle a single service's `sensitive` flag from the Settings curation
  // list. The flag lives on the service (not AppSettings), so we persist the
  // whole list like any other service edit and reload.
  // Flag one or more services sensitive in a single save. The Settings list
  // uses the multi-id form when a project checkbox toggles all of its services
  // at once, so we don't fan out into one save+reload per service.
  const setServicesSensitive = useCallback(
    async (serviceIds: string[], sensitive: boolean) => {
      const ids = new Set(serviceIds);
      const next = services.map((service) =>
        ids.has(service.id) ? { ...service, sensitive } : service
      );
      await invoke("save_services", { services: next });
      await reloadServices();
    },
    [services, reloadServices]
  );

  const markFocusedProjectSensitive = useCallback(
    async (service: ServiceConfig) => {
      const groupName = groupKey(service);
      const grouped = groupName !== "Ungrouped";
      const serviceIds = grouped
        ? servicesRef.current
            .filter((candidate) => groupKey(candidate) === groupName)
            .map((candidate) => candidate.id)
        : [service.id];
      await setServicesSensitive(serviceIds, true);
      if (grouped) {
        const current = settingsRef.current;
        await persistSettings({
          ...current,
          sensitiveProjectNames: { ...current.sensitiveProjectNames, [groupName]: true }
        });
        setManagerMessage(`Marked ${groupName} sensitive`);
      } else {
        setManagerMessage(`Marked ${service.name} sensitive`);
      }
    },
    [persistSettings, setServicesSensitive]
  );

  // Delete a profile from Settings: reassign its services to unassigned (never
  // delete them), then drop it from the registry and clear the active filter if
  // it pointed here. Done in two persists — services first, settings second —
  // so a half-failure leaves an empty-but-valid profile rather than orphans.
  const deleteProfile = useCallback(
    async (profileId: string) => {
      const affected = servicesRef.current.some((service) => service.profile === profileId);
      if (affected) {
        const next = servicesRef.current.map((service) =>
          service.profile === profileId ? { ...service, profile: null } : service
        );
        await invoke("save_services", { services: next });
        await reloadServices();
      }
      const current = settingsRef.current;
      await persistSettings({
        ...current,
        profiles: current.profiles.filter((profile) => profile.id !== profileId),
        activeProfile: current.activeProfile === profileId ? null : current.activeProfile
      });
    },
    [persistSettings, reloadServices]
  );

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

  // Reorder whole groups. Group order is derived from the order services first
  // appear in `services.json`, so moving a group means moving all of its
  // services as one block. We rebuild the array group-block by group-block in
  // the new order (preserving each group's internal service order), which keeps
  // every other field untouched.
  const reorderGroup = useCallback(
    async (
      sourceGroup: string,
      target: { groupName: string; edge: "before" | "after" }
    ) => {
      if (sourceGroup === target.groupName) return;

      const grouped = groupServices(services);
      const order = grouped.map(([name]) => name);
      if (order.indexOf(sourceGroup) === -1 || order.indexOf(target.groupName) === -1) {
        return;
      }

      const without = order.filter((name) => name !== sourceGroup);
      let insertAt = without.indexOf(target.groupName);
      if (target.edge === "after") insertAt += 1;

      const nextOrder = [
        ...without.slice(0, insertAt),
        sourceGroup,
        ...without.slice(insertAt)
      ];
      // No-op if nothing actually moved.
      if (nextOrder.every((name, i) => name === order[i])) return;

      const byGroup = new Map(grouped);
      const next = nextOrder.flatMap((name) => byGroup.get(name) ?? []);
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
    const collapsed = !settingsRef.current.collapsedProjectNames[groupName];
    const nextSettings = {
      ...settingsRef.current,
      collapsedProjectNames: {
        ...settingsRef.current.collapsedProjectNames,
        [groupName]: collapsed
      }
    };

    void persistSettings(nextSettings).catch((error) => {
      console.warn("Failed to persist project collapse state:", errorMessage(error));
    });
  }, [persistSettings]);

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
    logRevisionsRef.current[serviceId] = (logRevisionsRef.current[serviceId] ?? 0) + 1;
    // Force the next appended chunk to be treated as the start of a fresh
    // line so it picks up a timestamp even mid-stream.
    lineStateRef.current[serviceId] = true;
    // Discard any output buffered for the next frame so it can't repopulate
    // the terminal we're about to clear.
    pendingWritesRef.current.delete(serviceId);
    const pendingCarriageReturn = pendingPtyCarriageReturnsRef.current.get(serviceId);
    if (pendingCarriageReturn) {
      window.clearTimeout(pendingCarriageReturn.timer);
      pendingPtyCarriageReturnsRef.current.delete(serviceId);
    }
    terminalsRef.current.get(serviceId)?.clear();
  }, []);

  // The Ctrl+K shortcut clears whichever pane is focused.
  const clearSelectedLog = useCallback(() => {
    if (selected) clearLog(selected.id);
  }, [selected, clearLog]);

  const preparePrivacySnapshot = useCallback((serviceId: string) => {
    pendingWritesRef.current.delete(serviceId);
    const pending = pendingPtyCarriageReturnsRef.current.get(serviceId);
    if (pending) {
      window.clearTimeout(pending.timer);
      pendingPtyCarriageReturnsRef.current.delete(serviceId);
    }
  }, []);

  const toggleStreamMode = useCallback(() => {
    const next = !streamModeRef.current;

    // Anything waiting for the next animation frame was transformed for the
    // previous privacy state. The raw copy already lives in logsRef, so discard
    // those display writes and let each pane rebuild from the raw snapshot.
    if (flushRafRef.current !== 0) {
      cancelAnimationFrame(flushRafRef.current);
      flushRafRef.current = 0;
    }
    pendingWritesRef.current.clear();
    for (const pending of pendingPtyCarriageReturnsRef.current.values()) {
      window.clearTimeout(pending.timer);
    }
    pendingPtyCarriageReturnsRef.current.clear();

    // Update the long-lived output listener before scheduling React so output
    // arriving during the transition is transformed for the new mode.
    streamModeRef.current = next;
    setStreamMode(next);
  }, []);

  const toggleProjectNamePrivacy = useCallback((groupName: string) => {
    const current = settingsRef.current;
    const hidden = !current.hiddenProjectNames[groupName];
    const nextSettings = {
      ...current,
      hiddenProjectNames: {
        ...current.hiddenProjectNames,
        [groupName]: hidden
      },
      projectNameAliases: hidden ? projectNameAliases : current.projectNameAliases
    };

    void persistSettings(nextSettings).catch((error) => {
      console.warn("Failed to toggle project name privacy:", errorMessage(error));
    });
  }, [persistSettings, projectNameAliases]);

  const toggleProjectPinned = useCallback((groupName: string) => {
    const current = settingsRef.current;
    const nextPinned = { ...(current.pinnedProjectNames ?? {}) };
    const pinned = !(nextPinned[groupName] ?? false);
    if (pinned) {
      nextPinned[groupName] = true;
    } else {
      delete nextPinned[groupName];
    }

    void persistSettings({ ...current, pinnedProjectNames: nextPinned }).catch((error) => {
      console.warn("Failed to toggle pinned project:", errorMessage(error));
    });
  }, [persistSettings]);

  // Display name for a service, masked when stream mode is on and the service
  // is flagged sensitive. Used everywhere a service name is shown as UI chrome.
  const maskName = useCallback(
    (service: ServiceConfig) => displayServiceName(service, streamMode),
    [streamMode]
  );

  // Registry backing the command palette. Small and declarative; the headline
  // action is stream-mode (mask sensitive names for screen-sharing), with a few
  // common toggles alongside so the palette is useful on its own.
  const sensitiveCount = useMemo(
    () => services.filter((service) => service.sensitive).length,
    [services]
  );
  const commands = useMemo<Command[]>(
    () => [
      {
        id: "stream-mode",
        title: streamMode
          ? "Stream mode: show sensitive names"
          : "Stream mode: hide sensitive names",
        subtitle:
          sensitiveCount === 0
            ? "No services marked sensitive yet — set “Sensitive name” when editing a service"
            : `Masks ${sensitiveCount} sensitive service name${
                sensitiveCount === 1 ? "" : "s"
              } so the window is safe to screen-share`,
        badge: streamMode ? "On" : "Off",
        keywords: "stream privacy mask hide sensitive screen share present demo record",
        run: toggleStreamMode
      },
      {
        id: "new-service",
        title: "New service",
        keywords: "add create",
        run: () => setEditing({ mode: "new" })
      },
      {
        id: "new-profile",
        title: "New profile",
        subtitle: "Create a profile and switch to it",
        keywords: "add create profile group separate workspace context",
        run: () => setProfilePromptOpen(true)
      },
      {
        id: "search-logs",
        title: "Search all logs",
        keywords: "find grep",
        run: () => setSearchOpen(true)
      },
      {
        id: "toggle-terminal",
        title: terminalOpen ? "Hide bottom terminal" : "Show bottom terminal",
        badge: terminalOpen ? "On" : "Off",
        keywords: "shell drawer",
        run: () => setTerminalOpen((open) => !open)
      },
      {
        id: "toggle-settings",
        title: settingsOpen ? "Close settings" : "Open settings",
        keywords: "preferences config",
        run: () => setSettingsOpen((open) => !open)
      },
      {
        id: "toggle-left-sidebar",
        title: leftSidebarOpen ? "Hide services sidebar" : "Show services sidebar",
        keywords: "panel left",
        run: () => setLeftSidebarOpen((open) => !open)
      },
      {
        id: "toggle-right-sidebar",
        title: rightSidebarOpen ? "Hide details sidebar" : "Show details sidebar",
        keywords: "panel right inspector details",
        run: () => setRightSidebarOpen((open) => !open)
      }
    ],
    [streamMode, sensitiveCount, terminalOpen, settingsOpen, leftSidebarOpen, rightSidebarOpen, toggleStreamMode]
  );

  // Global keyboard shortcuts. Registered in the capture phase so they fire
  // before a focused terminal — xterm consumes Ctrl-combos and stops their
  // propagation, so a bubble-phase listener would never see them. For each
  // shortcut we handle, `stopPropagation` then keeps the key from also
  // reaching the terminal. Modifier combos are ignored while the user is
  // typing in a real form field.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (profilePromptOpen) {
          setProfilePromptOpen(false);
          return;
        }
        if (commandOpen) {
          setCommandOpen(false);
          return;
        }
        if (searchOpen) {
          setSearchOpen(false);
          return;
        }
        if (searchPaneId) {
          // The PaneSearchBar's own Esc handler runs first when its input is
          // focused — this is the fallback for when focus is elsewhere
          // (e.g. user clicked back into the terminal but still wants Esc
          // to dismiss the bar).
          setSearchPaneId(null);
          setPaneSearchSeed(null);
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

      const shortcutTarget = event.target as HTMLElement | null;
      const shortcutInForm =
        shortcutTarget != null &&
        (shortcutTarget.tagName === "INPUT" ||
          shortcutTarget.tagName === "TEXTAREA" ||
          shortcutTarget.isContentEditable) &&
        !shortcutTarget.classList.contains("xterm-helper-textarea");

      // Ctrl/Cmd + Shift + S marks the focused project sensitive. It is
      // intentionally one-way so an accidental repeat cannot expose it.
      if (event.shiftKey && event.key.toLowerCase() === "s") {
        if (!shortcutInForm && selected && paneIds.includes(selected.id)) {
          event.preventDefault();
          event.stopPropagation();
          void markFocusedProjectSensitive(selected).catch((error) => {
            setManagerMessage(`Could not mark project sensitive: ${errorMessage(error)}`);
          });
        }
        return;
      }

      // Ctrl/Cmd + Shift + Down cycles profiles in visible order, including
      // All profiles, and wraps at the end.
      if (event.shiftKey && event.key === "ArrowDown") {
        if (!shortcutInForm) {
          event.preventDefault();
          event.stopPropagation();
          cycleProfile();
        }
        return;
      }

      if (event.altKey || event.shiftKey) {
        return;
      }

      // Ctrl/Cmd + F → in-pane search bar for the focused pane. Handled here
      // (before the form-field bail-out below) so it works while the xterm
      // helper textarea has focus — that's the common case after clicking
      // into a terminal pane.
      if (event.key.toLowerCase() === "f") {
        const targetId = selected && paneIds.includes(selected.id) ? selected.id : null;
        if (targetId) {
          event.preventDefault();
          event.stopPropagation();
          setSearchPaneId(targetId);
        }
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
      // Ctrl/Cmd + P → command palette.
      if (event.key.toLowerCase() === "p") {
        event.preventDefault();
        event.stopPropagation();
        setCommandOpen((open) => !open);
        return;
      }

      // Ctrl/Cmd + 1..9 → open the Nth visible service as the sole pane.
      if (/^[1-9]$/.test(event.key)) {
        const service = flatServices[Number(event.key) - 1];
        if (service) {
          event.preventDefault();
          event.stopPropagation();
          openService(service.id);
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
            void restartService(selected);
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
    restartService,
    stopService,
    clearSelectedLog,
    openService,
    paneIds,
    closePane,
    settingsOpen,
    searchPaneId,
    commandOpen,
    profilePromptOpen
    ,cycleProfile
    ,markFocusedProjectSensitive
  ]);

  // Suppress the WebView's native context menu on non-editable app chrome.
  // The right-click menu it shows there is pure browser leftovers — Back,
  // Refresh (which reloads the whole webview and wipes UI state — and clashes
  // with our own Ctrl/Cmd+R "restart service" shortcut), Save as, Print — none
  // of which make sense for a desktop process manager. We keep the genuinely
  // useful native menu (Cut/Copy/Paste/Select all/Emoji) where editing or
  // selection matters: text inputs and the xterm terminal panes.
  //
  // PROD-gated so the inspector's right-click "Inspect element" stays available
  // in `tauri dev`. The inspector is off in release builds anyway (no `devtools`
  // Cargo feature), so this only ever strips the browser page menu, never tools.
  useEffect(() => {
    if (!import.meta.env.PROD) {
      return;
    }
    function onContextMenu(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const allowNative =
        target != null &&
        target.closest(
          "input, textarea, [contenteditable='true'], .xterm"
        ) != null;
      if (!allowNative) {
        event.preventDefault();
      }
    }
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  if (!workspaceReady || startupError) return <StartupScreen error={startupError} />;

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
      <ServicesSidebar
        open={leftSidebarOpen}
        managerMessage={managerMessage}
        compact={compactSidebar}
        modKey={modKey}
        groupedServices={groupedServices}
        statuses={statuses}
        collapsedGroups={collapsedGroups}
        settings={settings}
        streamMode={streamMode}
        projectNameAliases={projectNameAliases}
        profiles={settings.profiles}
        activeProfile={activeProfile}
        setActiveProfile={setActiveProfile}
        runningElsewhere={runningElsewhere}
        profileActivity={profileActivity}
        serviceQuery={serviceQuery}
        setServiceQuery={setServiceQuery}
        dropIndicator={dropIndicator}
        dragId={dragId}
        dragIdRef={dragIdRef}
        dragGroup={dragGroup}
        dragGroupRef={dragGroupRef}
        paneIds={paneIds}
        portConflicts={portConflicts}
        selected={selected}
        iconImages={iconImages}
        displayProjectName={displayProjectName}
        maskName={maskName}
        setDropIndicator={setDropIndicator}
        setEditing={setEditing}
        toggleGroupCollapsed={toggleGroupCollapsed}
        toggleProjectPinned={toggleProjectPinned}
        toggleProjectNamePrivacy={toggleProjectNamePrivacy}
        startGroup={startGroup}
        stopGroup={stopGroup}
        beginDrag={beginDrag}
        endDrag={endDrag}
        reorderService={reorderService}
        beginGroupDrag={beginGroupDrag}
        endGroupDrag={endGroupDrag}
        reorderGroup={reorderGroup}
        openService={openService}
        openInSplit={openInSplit}
      />

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
            {runtimeReport && runtimeReport.issues.length > 0 ? (
              <Tooltip label="Runtime requirements missing">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setRuntimeWarningOpen(true)}
                  aria-label="Show missing runtime requirements"
                  className="text-amber-300"
                >
                  <AlertTriangleIcon className="size-4" />
                </Button>
              </Tooltip>
            ) : runtimeReport && runtimeReport.activeFallbackPaths.length > 0 ? (
              <Tooltip label="Runtime fallback active for this session">
                <span
                  role="status"
                  aria-label="Runtime fallback active"
                  className="flex size-7 items-center justify-center text-cyan-400"
                >
                  <AlertTriangleIcon className="size-4" />
                </span>
              </Tooltip>
            ) : null}
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
            <Tooltip label={`Command palette (${modKey}+P)`}>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setCommandOpen(true)}
                aria-label="Open command palette"
                className={streamMode ? "text-cyan-400" : ""}
              >
                <CommandIcon className="size-4" />
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
            streamMode={streamMode}
            projectNameAliases={projectNameAliases}
            statuses={statuses}
            pids={pids}
            gridColumns={settings.paneGridColumns}
            tabMode={settings.openServicesInTabs ?? true}
            panels={workspacePanels}
            theme={resolvedTheme}
            onPrivacySnapshotStart={preparePrivacySnapshot}
            awaitingOutput={awaitingOutput}
            startHealth={startHealth}
            terminalsRef={terminalsRef}
            logsRef={logsRef}
            searchPaneId={searchPaneId}
            searchSeed={paneSearchSeed}
            flashServiceId={flashServiceId}
            flashNonce={flashNonce}
            portBlockers={portBlockers}
            adoptedPids={adoptedPids}
            onStopBlockerAndRestart={stopBlockerAndRestart}
            onAdoptRunningInstance={adoptRunningInstance}
            onReleaseAdopted={releaseAdopted}
            onFocus={focusPanelTab}
            onTabFocus={focusPanelTab}
            onTabMove={movePanelTab}
            onClose={(panelId, id) => {
              if (searchPaneId === id) setSearchPaneId(null);
              if (paneSearchSeed?.serviceId === id) setPaneSearchSeed(null);
              closePane(id, panelId);
            }}
            onStart={manualStart}
            onStop={stopService}
            onClear={clearLog}
            onOpenSearch={(id) => {
              // User-initiated Ctrl+F should never re-use a stale seed from a
              // previous global-search jump.
              if (paneSearchSeed?.serviceId !== id) setPaneSearchSeed(null);
              setSearchPaneId(id);
            }}
            onCloseSearch={() => {
              setSearchPaneId(null);
              setPaneSearchSeed(null);
            }}
          />
          <BottomTerminal
            open={terminalOpen}
            height={terminalHeight}
            theme={resolvedTheme}
            onClose={() => setTerminalOpen(false)}
            onResizeStart={startTerminalDrag}
          />
        </div>
        {settingsOpen ? (
          <SettingsView
            settings={settings}
            services={services}
            onClose={() => setSettingsOpen(false)}
            onSave={persistSettings}
            onThemePreview={setPreviewTheme}
            onSetServicesSensitive={setServicesSensitive}
            onDeleteProfile={deleteProfile}
            streamMode={streamMode}
          />
        ) : null}
      </section>

      <aside
        className={`flex min-h-0 flex-col overflow-hidden bg-[#15181d] ${
          rightSidebarOpen ? "border-l border-white/10" : ""
        }`}
      >
        <DetailsSidebar
          editing={editing}
          services={services}
          selected={selected}
          settings={settings}
          activeProfile={activeProfile}
          streamMode={streamMode}
          projectNameAliases={projectNameAliases}
          statuses={statuses}
          pids={pids}
          actualPorts={actualPorts}
          adoptedPids={adoptedPids}
          lastExit={lastExit}
          history={history}
          iconImages={iconImages}
          displayProjectName={displayProjectName}
          appendLog={appendLog}
          onImport={importServices}
          onSaveService={saveServiceConfig}
          onDeleteService={deleteServiceConfig}
          onEdit={setEditing}
        />
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
        logRevisions={logRevisionsRef.current}
        streamMode={streamMode}
        projectNameAliases={projectNameAliases}
        onJump={jumpToSearchResult}
        onClose={() => setSearchOpen(false)}
      />
    ) : null}
    {commandOpen ? (
      <CommandPalette commands={commands} onClose={() => setCommandOpen(false)} />
    ) : null}
    {profilePromptOpen ? (
      <ProfilePrompt
        existingNames={settings.profiles.map((profile) => profile.name)}
        onCreate={createProfile}
        onClose={() => setProfilePromptOpen(false)}
      />
    ) : null}
    {runtimeWarningOpen && runtimeReport && runtimeReport.issues.length > 0 ? (
      <RuntimeRequirements
        report={runtimeReport}
        onActivate={activateRuntimeFallback}
        onRecheck={() => scanRuntimeRequirements(servicesRef.current).then(() => undefined)}
        onClose={() => setRuntimeWarningOpen(false)}
      />
    ) : null}
    </>
  );
}
