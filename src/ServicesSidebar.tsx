import type { MutableRefObject } from "react";
import type { AppSettings, Profile, ServiceConfig, ServiceStatus } from "./types";
import type { EditTarget } from "./appTypes";
import { formatCommand } from "./types";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";
import { ServiceIconBadge } from "./ServiceIconBadge";
import { ProfileSwitcher } from "./ProfileSwitcher";
import { statusLabels } from "./appUtils";
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
  statuses: Record<string, ServiceStatus>;
  collapsedGroups: Record<string, boolean>;
  settings: AppSettings;
  // Managed profiles + the active selection. The switcher filters the list to
  // the active profile (plus unassigned services); null = "All profiles".
  profiles: Profile[];
  activeProfile: string | null;
  setActiveProfile: (profileId: string | null) => void;
  // How many running/starting services are hidden by the active profile, so the
  // user is reminded something is alive outside the current view.
  runningElsewhere: number;
  profileActivity: { global: number; byProfile: Record<string, number> };
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
};

export function ServicesSidebar({
  open,
  managerMessage,
  compact,
  modKey,
  groupedServices,
  statuses,
  collapsedGroups,
  settings,
  profiles,
  activeProfile,
  setActiveProfile,
  runningElsewhere,
  profileActivity,
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
  openInSplit
}: Props) {
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

        {profiles.length > 0 ? (
          <div className="mt-3">
            <ProfileSwitcher
              profiles={profiles}
              activeProfile={activeProfile}
              setActiveProfile={setActiveProfile}
              activity={profileActivity}
            />
            {activeProfile && runningElsewhere > 0 ? (
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-cyan-300/90">
                <span className="size-1.5 rounded-full bg-cyan-400" aria-hidden="true" />
                {runningElsewhere} running in other{" "}
                {runningElsewhere === 1 ? "profile" : "profiles"}
              </p>
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
        {groupedServices.length === 0 && activeProfile ? (
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
                    draggable
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
                        draggable
                        onDragStart={(event) => {
                          beginDrag(service.id);
                          event.dataTransfer.effectAllowed = "move";
                          try {
                            event.dataTransfer.setData("text/plain", service.id);
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
                        <span className="flex items-center justify-between gap-3">
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
                        <span className="mt-1 block truncate pl-10 font-mono text-xs text-zinc-500">
                          {formatCommand(service)}
                        </span>
                        {showConflict ? (
                          <span className="mt-1 block pl-10 text-[11px] text-amber-300">
                            port {service.port} in use
                          </span>
                        ) : null}
                        {isOpen ? (
                          <Tooltip label="Open in a pane" className="absolute top-2 right-2 text-cyan-400">
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
                            aria-label={`Open ${maskName(service)} in split view`}
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
  );
}
