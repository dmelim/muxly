import type { MutableRefObject } from "react";
import type { AppSettings, Profile, ServiceConfig, ServiceStatus } from "./types";
import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { EditTarget } from "./appTypes";
import { formatCommand, redactSensitive } from "./types";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";
import { ServiceIconBadge } from "./ServiceIconBadge";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { statusLabels } from "./appUtils";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  GripVerticalIcon,
  PlayIcon,
  PinIcon,
  PlusIcon,
  SplitIcon,
  StopIcon
  ,CloseIcon
  ,SearchIcon
} from "./icons";

type DropIndicator =
  | { kind: "before-service"; serviceId: string }
  | { kind: "end-of-group"; groupName: string }
  | { kind: "group"; groupName: string; edge: "before" | "after" }
  | null;

type Props = {
  open: boolean;
  managerMessage: string;
  compact: boolean;
  modKey: string;
  groupedServices: Array<[string, ServiceConfig[]]>;
  allProjectNames: string[];
  statuses: Record<string, ServiceStatus>;
  collapsedGroups: Record<string, boolean>;
  settings: AppSettings;
  streamMode: boolean;
  projectNameAliases: Record<string, string>;
  // Managed profiles + the active selection. The switcher filters the list to
  // the active profile (plus unassigned services); null = "All profiles".
  profiles: Profile[];
  activeProfile: string | null;
  setActiveProfile: (profileId: string | null) => void;
  // How many running/starting services are hidden by the active profile, so the
  // user is reminded something is alive outside the current view.
  runningElsewhere: ServiceConfig[];
  profileActivity: { global: number; byProfile: Record<string, number> };
  serviceQuery: string;
  setServiceQuery: (query: string) => void;
  dropIndicator: DropIndicator;
  dragId: string | null;
  dragIdRef: MutableRefObject<string | null>;
  dragGroup: string | null;
  dragGroupRef: MutableRefObject<string | null>;
  paneIds: string[];
  portConflicts: Record<string, boolean>;
  selected: ServiceConfig | null;
  iconImages: Record<string, string | null>;
  displayProjectName: (groupName: string) => string;
  maskName: (service: ServiceConfig) => string;
  setDropIndicator: (indicator: DropIndicator | ((current: DropIndicator) => DropIndicator)) => void;
  setEditing: (target: EditTarget | null) => void;
  toggleGroupCollapsed: (groupName: string) => void;
  toggleProjectPinned: (groupName: string) => void;
  toggleProjectNamePrivacy: (groupName: string) => void;
  startGroup: (groupName: string) => void;
  stopGroup: (groupName: string) => void;
  beginDrag: (serviceId: string) => void;
  endDrag: () => void;
  reorderService: (
    sourceId: string,
    target:
      | { kind: "before-service"; serviceId: string }
      | { kind: "end-of-group"; groupName: string }
  ) => Promise<void>;
  beginGroupDrag: (groupName: string) => void;
  endGroupDrag: () => void;
  reorderGroup: (
    sourceGroup: string,
    target: { groupName: string; edge: "before" | "after" }
  ) => Promise<void>;
  openService: (serviceId: string) => void;
  openInSplit: (serviceId: string) => void;
  onServiceMenuAction: (action: ServiceMenuAction, service: ServiceConfig, value?: string | null) => void;
  onGroupMenuAction: (action: GroupMenuAction, groupName: string) => void;
  onDeleteService: (service: ServiceConfig) => Promise<void>;
};

export type ServiceMenuAction = "show" | "tab" | "replace" | "panel" | "move-current" | "start" | "stop" | "restart" | "edit" | "duplicate" | "project" | "profile" | "editor" | "reveal" | "browser" | "copy-name" | "copy-command" | "copy-cwd" | "copy-url";
export type GroupMenuAction = "start" | "stop" | "add" | "pin" | "collapse" | "sensitive";

export function ServicesSidebar({
  open,
  managerMessage,
  compact,
  modKey,
  groupedServices,
  allProjectNames,
  statuses,
  collapsedGroups,
  settings,
  streamMode,
  projectNameAliases,
  profiles,
  activeProfile,
  setActiveProfile,
  runningElsewhere,
  profileActivity,
  serviceQuery,
  setServiceQuery,
  dropIndicator,
  dragId,
  dragIdRef,
  dragGroup,
  dragGroupRef,
  paneIds,
  portConflicts,
  selected,
  iconImages,
  displayProjectName,
  maskName,
  setDropIndicator,
  setEditing,
  toggleGroupCollapsed,
  toggleProjectPinned,
  toggleProjectNamePrivacy,
  startGroup,
  stopGroup,
  beginDrag,
  endDrag,
  reorderService,
  beginGroupDrag,
  endGroupDrag,
  reorderGroup,
  openService,
  openInSplit,
  onServiceMenuAction,
  onGroupMenuAction
  ,onDeleteService
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const menuTargetRef = useRef<HTMLElement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ServiceConfig | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  useEffect(() => setMenu(null), [activeProfile, allProjectNames, groupedServices, paneIds, profiles, settings, statuses, streamMode]);
  const showMenu = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>, items: ContextMenuItem[]) => {
    event.preventDefault();
    event.stopPropagation();
    menuTargetRef.current = event.currentTarget;
    const rect = event.currentTarget.getBoundingClientRect();
    const mouse = "clientX" in event && event.clientX > 0;
    setMenu({ x: mouse ? event.clientX : rect.left + 12, y: mouse ? event.clientY : rect.bottom, items });
  };
  const serviceItems = (service: ServiceConfig): ContextMenuItem[] => {
    const status = statuses[service.id] ?? "stopped";
    const busy = ["starting", "restarting", "stopping"].includes(status);
    const live = ["running", "starting", "restarting", "stopping"].includes(status);
    const isOpen = paneIds.includes(service.id);
    const tabless = !(settings.openServicesInTabs ?? true);
    const validUrl = service.port != null && service.port > 0 && service.port <= 65535;
    const projects = allProjectNames;
    return [
      isOpen ? { id: "show", label: "Show Existing Tab", action: () => onServiceMenuAction("show", service) } : { id: "tab", label: "New Tab", disabled: tabless, reason: "Tab mode is disabled in Settings", action: () => onServiceMenuAction("tab", service) },
      isOpen ? { id: "move-current", label: "Move to Current Panel", disabled: tabless, reason: "Tab mode is disabled in Settings", action: () => onServiceMenuAction("move-current", service) } : { id: "replace", label: "Replace Current Tab", disabled: tabless, reason: "Tab mode is disabled in Settings", action: () => onServiceMenuAction("replace", service) },
      { id: "panel", label: "New Panel", action: () => onServiceMenuAction("panel", service) },
      { id: "s1", separator: true },
      { id: "start-stop", label: live ? "Stop" : "Start", disabled: busy, action: () => onServiceMenuAction(live ? "stop" : "start", service) },
      { id: "restart", label: "Restart", disabled: busy, action: () => onServiceMenuAction("restart", service) },
      { id: "s2", separator: true },
      { id: "edit", label: "Edit Service", action: () => onServiceMenuAction("edit", service) },
      { id: "duplicate", label: "Duplicate Service", action: () => onServiceMenuAction("duplicate", service) },
      { id: "project", label: "Move to Project", children: [
        ...projects.map((name) => ({ id: `project-${name}`, label: displayProjectName(name), checked: (service.group?.trim() || "Ungrouped") === name, disabled: (service.group?.trim() || "Ungrouped") === name, action: () => onServiceMenuAction("project", service, name === "Ungrouped" ? null : name) })),
        ...(!projects.includes("Ungrouped") ? [{ id: "project-none", label: "Ungrouped", checked: !service.group, disabled: !service.group, action: () => onServiceMenuAction("project", service, null) }] : [])
      ] },
      { id: "profile", label: "Assign to Profile", children: [
        { id: "profile-none", label: "Unassigned", checked: !service.profile, disabled: !service.profile, action: () => onServiceMenuAction("profile", service, null) },
        ...profiles.map((profile, index) => ({ id: `profile-${profile.id}`, label: streamMode && service.sensitive ? `Profile ${index + 1}` : profile.name, checked: service.profile === profile.id, disabled: service.profile === profile.id, action: () => onServiceMenuAction("profile", service, profile.id) }))
      ] },
      { id: "s3", separator: true },
      { id: "editor", label: "Open in configured Editor", action: () => onServiceMenuAction("editor", service) },
      { id: "reveal", label: "Reveal in File Manager", action: () => onServiceMenuAction("reveal", service) },
      { id: "browser", label: "Open in Browser", disabled: !validUrl, reason: "This service has no valid port", action: () => onServiceMenuAction("browser", service) },
      { id: "copy", label: "Copy", children: [
        { id: "copy-name", label: "Name", action: () => onServiceMenuAction("copy-name", service) },
        { id: "copy-command", label: "Command", disabled: streamMode && service.sensitive, reason: "Hidden while Stream mode is on", action: () => onServiceMenuAction("copy-command", service) },
        { id: "copy-cwd", label: "Working directory", disabled: streamMode && service.sensitive, reason: "Hidden while Stream mode is on", action: () => onServiceMenuAction("copy-cwd", service) },
        { id: "copy-url", label: "URL", disabled: !validUrl, action: () => onServiceMenuAction("copy-url", service) }
      ] },
      { id: "s4", separator: true },
      { id: "delete", label: "Delete Service…", danger: true, disabled: live, reason: "Stop the service before deleting it", action: () => setDeleteTarget(service) }
    ];
  };
  return (
    <aside
      className={`flex min-h-0 flex-col overflow-hidden bg-[#15181d] ${
        open ? "border-r border-white/10" : ""
      }`}
    >
      <div className="border-b border-white/10 px-5 py-4">
        <h1 className="text-xl font-semibold tracking-normal">Muxly</h1>
        <p className="mt-2 line-clamp-2 text-xs text-zinc-500" title={managerMessage}>
          {managerMessage}
        </p>
        <div className="mt-3 flex gap-2">
          {compact ? (
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
            className={compact ? "flex-1" : ""}
          >
            <Button
              variant="dashed"
              size="sm"
              onClick={() => setEditing({ mode: "import" })}
              className={compact ? "w-full" : ""}
            >
              Import
            </Button>
          </Tooltip>
        </div>

        <div className="relative mt-3">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
          <input
            value={serviceQuery}
            onChange={(event) => setServiceQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && serviceQuery) {
                event.preventDefault();
                setServiceQuery("");
              }
            }}
            aria-label="Search services"
            placeholder="Search services…"
            className="form-input search-input py-1.5 text-xs"
          />
          {serviceQuery ? (
            <button type="button" onClick={() => setServiceQuery("")} aria-label="Clear service search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40">
              <CloseIcon className="size-3" />
            </button>
          ) : null}
        </div>

        {profiles.length > 0 ? (
          <div className="mt-3">
            <ProfileSwitcher
              profiles={profiles}
              activeProfile={activeProfile}
              setActiveProfile={setActiveProfile}
              activity={profileActivity}
            />
            {activeProfile && runningElsewhere.length > 0 ? (
              <Tooltip
                className="mt-2"
                label={`${runningElsewhere.length} ${runningElsewhere.length === 1 ? "service" : "services"} running in other profiles:\n${runningElsewhere.map(maskName).join("\n")}`}
              >
              <p className="flex items-center gap-1.5 text-[11px] text-cyan-300/90">
                <span className="size-1.5 rounded-full bg-[var(--muxly-status-running)]" aria-hidden="true" />
                {runningElsewhere.length} running in other{" "}
                {runningElsewhere.length === 1 ? "profile" : "profiles"}
              </p>
              </Tooltip>
            ) : null}
          </div>
        ) : null}
      </div>

      <div
        onDragEnter={(event) => {
          if (dragIdRef.current || dragGroupRef.current) event.preventDefault();
        }}
        onDragOver={(event) => {
          if (dragIdRef.current || dragGroupRef.current) event.preventDefault();
        }}
        className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden p-3"
      >
        {groupedServices.length === 0 && serviceQuery.trim() ? (
          <div className="px-3 py-8 text-center">
            <p className="text-sm text-zinc-400">No services match “{serviceQuery.trim()}”</p>
            <button type="button" onClick={() => setServiceQuery("")} className="mt-2 text-xs text-cyan-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40">Clear search</button>
          </div>
        ) : groupedServices.length === 0 && activeProfile ? (
          <div className="px-3 py-8 text-center">
            <p className="text-sm text-zinc-400">No services in this profile</p>
            <p className="mt-1 text-xs text-zinc-500">
              Assign a service to it when editing, create a new one, or switch to{" "}
              <button
                type="button"
                onClick={() => setActiveProfile(null)}
                className="text-cyan-400 underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
              >
                All profiles
              </button>
              .
            </p>
          </div>
        ) : null}
        {groupedServices.map(([groupName, groupServicesList]) => {
          const anyRunning = groupServicesList.some((service) => {
            const status = statuses[service.id];
            return status === "running" || status === "starting" || status === "restarting";
          });
          const collapsed = collapsedGroups[groupName] ?? false;
          const groupPinned = settings.pinnedProjectNames?.[groupName] ?? false;
          const groupHidden = settings.hiddenProjectNames[groupName] ?? false;
          const groupSensitive = settings.sensitiveProjectNames[groupName] ?? false;
          const displayGroupName = displayProjectName(groupName);
          // A service drag onto this header appends to the group (end-of-group);
          // a group drag onto it reorders whole groups (before/after this one).
          // The two never overlap — only one of dragIdRef / dragGroupRef is set.
          const headerHighlighted =
            dropIndicator?.kind === "end-of-group" && dropIndicator.groupName === groupName;
          const groupDropEdge =
            dropIndicator?.kind === "group" && dropIndicator.groupName === groupName
              ? dropIndicator.edge
              : null;
          const isGroupDragging = dragGroup === groupName;

          return (
            <div
              key={groupName}
              className={`group/group relative space-y-1.5 transition-opacity ${
                isGroupDragging ? "opacity-40" : ""
              }`}
            >
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute -top-2.5 left-0 right-0 h-0.5 rounded-full bg-cyan-400 transition-opacity ${
                  groupDropEdge === "before" ? "opacity-100" : "opacity-0"
                }`}
              />
              <span
                aria-hidden="true"
                className={`pointer-events-none absolute -bottom-2.5 left-0 right-0 h-0.5 rounded-full bg-cyan-400 transition-opacity ${
                  groupDropEdge === "after" ? "opacity-100" : "opacity-0"
                }`}
              />
              <div
                onContextMenu={(event) => showMenu(event, [
                  { id: "start", label: "Start All", action: () => onGroupMenuAction("start", groupName) },
                  { id: "stop", label: "Stop All", disabled: !anyRunning, action: () => onGroupMenuAction("stop", groupName) },
                  { id: "add", label: "Add Service Here", action: () => onGroupMenuAction("add", groupName) },
                  { id: "pin", label: groupPinned ? "Unpin" : "Pin", action: () => onGroupMenuAction("pin", groupName) },
                  { id: "collapse", label: collapsed ? "Expand" : "Collapse", action: () => onGroupMenuAction("collapse", groupName) },
                  { id: "sensitive", label: groupSensitive ? "Unmark Sensitive" : "Mark Sensitive", action: () => onGroupMenuAction("sensitive", groupName) }
                ])}
                onKeyDown={(event) => {
                  if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                  event.preventDefault();
                  const rect = event.currentTarget.getBoundingClientRect();
                  event.currentTarget.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: rect.left + 12, clientY: rect.bottom }));
                }}
                onDragOver={(event) => {
                  if (dragGroupRef.current) {
                    if (dragGroupRef.current === groupName) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    const rect = event.currentTarget.getBoundingClientRect();
                    const edge =
                      event.clientY < rect.top + rect.height / 2 ? "before" : "after";
                    setDropIndicator((current) =>
                      current?.kind === "group" &&
                      current.groupName === groupName &&
                      current.edge === edge
                        ? current
                        : { kind: "group", groupName, edge }
                    );
                    return;
                  }
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
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
                  setDropIndicator((current) => {
                    if (current?.kind === "group" && current.groupName === groupName) return null;
                    if (current?.kind === "end-of-group" && current.groupName === groupName) {
                      return null;
                    }
                    return current;
                  });
                }}
                onDrop={(event) => {
                  if (dragGroupRef.current) {
                    const sourceGroup = dragGroupRef.current;
                    event.preventDefault();
                    const rect = event.currentTarget.getBoundingClientRect();
                    const edge =
                      event.clientY < rect.top + rect.height / 2 ? "before" : "after";
                    endGroupDrag();
                    void reorderGroup(sourceGroup, { groupName, edge });
                    return;
                  }
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
                <div className="flex min-w-0 items-center gap-1">
                  <button
                    type="button"
                    draggable={!serviceQuery}
                    onDragStart={(event) => {
                      beginGroupDrag(groupName);
                      event.dataTransfer.effectAllowed = "move";
                      try {
                        event.dataTransfer.setData("text/plain", `group:${groupName}`);
                      } catch {
                        /* some browsers throw on custom MIME types */
                      }
                    }}
                    onDragEnd={endGroupDrag}
                    aria-label={`Reorder ${displayGroupName}`}
                    className="shrink-0 cursor-grab rounded p-0.5 text-zinc-600 opacity-0 transition hover:text-zinc-300 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 group-hover/group:opacity-100 active:cursor-grabbing"
                  >
                    <GripVerticalIcon className="size-3.5" />
                  </button>
                  <Tooltip label={displayGroupName} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => toggleGroupCollapsed(groupName)}
                      aria-expanded={!collapsed}
                      aria-label={`${collapsed ? "Expand" : "Collapse"} ${displayGroupName}`}
                      className="group/header flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left text-zinc-500 transition hover:bg-white/5 hover:text-zinc-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
                    >
                      <ChevronRightIcon
                        className={`size-3 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
                      />
                      <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.18em]">
                        {displayGroupName}
                      </span>
                    </button>
                  </Tooltip>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <Tooltip label={groupPinned ? "Unpin project" : "Pin project"}>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => toggleProjectPinned(groupName)}
                      aria-label={`${groupPinned ? "Unpin" : "Pin"} project ${displayGroupName}`}
                      aria-pressed={groupPinned}
                      className={groupPinned ? "text-cyan-400" : "text-zinc-500"}
                    >
                      <PinIcon className="size-3.5" />
                    </Button>
                  </Tooltip>
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
                      {groupHidden ? <EyeOffIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
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
                        onContextMenu={(event) => showMenu(event, serviceItems(service))}
                        draggable={!serviceQuery}
                        onDragStart={(event) => {
                          beginDrag(service.id);
                          event.dataTransfer.effectAllowed = "copyMove";
                          try {
                            event.dataTransfer.setData("text/plain", service.id);
                            event.dataTransfer.setData("application/x-muxly-service-id", service.id);
                          } catch {
                            /* Safari may throw on some MIME types. */
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
                          void reorderService(sourceId, { kind: "before-service", serviceId: service.id });
                        }}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => {
                          if (event.ctrlKey || event.metaKey) {
                            openInSplit(service.id);
                          } else {
                            openService(service.id);
                          }
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                            showMenu(event, serviceItems(service));
                            return;
                          }
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openService(service.id);
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
                        <span className="flex items-center justify-between gap-3 pr-8">
                          <span className="flex min-w-0 items-center gap-3">
                            <ServiceIconBadge
                              service={service}
                              imageSrc={iconImages[service.id]}
                              status={status}
                            />
                            <span className="truncate text-sm font-medium">{maskName(service)}</span>
                          </span>
                          {!isOpen ? (
                            <span className="shrink-0 text-xs text-zinc-500">
                              {statusLabels[status]}
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-1 block truncate pl-10 pr-8 font-mono text-xs text-zinc-500">
                          {redactSensitive(
                            formatCommand(service),
                            service,
                            projectNameAliases[service.group?.trim() || "Ungrouped"] ?? "",
                            streamMode
                          )}
                        </span>
                        {showConflict ? (
                          <span className="mt-1 block pl-10 pr-8 text-[11px] text-amber-300">
                            port {service.port} in use
                          </span>
                        ) : null}
                        <span className="absolute right-2 top-2 flex items-center gap-0.5">
                          {isOpen ? (
                          <Tooltip label="Open in a pane" className="text-cyan-400">
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
                        </span>
                        <Tooltip label="Open in new panel" className="absolute bottom-2 right-2">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openInSplit(service.id);
                            }}
                            aria-label={`Open ${maskName(service)} in a new panel`}
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
      {menu ? <ContextMenu {...menu} onClose={() => setMenu(null)} restoreFocusRef={menuTargetRef} /> : null}
      {deleteTarget ? (
        <ConfirmDialog
          title="Delete service?"
          message={deleteError ?? `Delete ${maskName(deleteTarget)} from Muxly? This does not remove project files.`}
          confirmLabel="Delete"
          destructive
          busy={deleting}
          onClose={() => { setDeleteTarget(null); setDeleteError(null); }}
          onConfirm={() => {
            setDeleting(true);
            setDeleteError(null);
            void onDeleteService(deleteTarget).then(() => setDeleteTarget(null)).catch(() => setDeleteError("Could not delete this service. Check the manager status and try again.")).finally(() => setDeleting(false));
          }}
        />
      ) : null}
    </aside>
  );
}
