import type { MutableRefObject } from "react";
import type { AppSettings, ServiceConfig, ServiceStatus } from "./types";
import type { EditTarget } from "./appTypes";
import { formatCommand } from "./types";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";
import { ServiceIconBadge } from "./ServiceIconBadge";
import { statusLabels } from "./appUtils";
import {
  ChevronRightIcon,
  EyeIcon,
  EyeOffIcon,
  PlayIcon,
  PlusIcon,
  SplitIcon,
  StopIcon
} from "./icons";

type DropIndicator =
  | { kind: "before-service"; serviceId: string }
  | { kind: "end-of-group"; groupName: string }
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
  dropIndicator: DropIndicator;
  dragId: string | null;
  dragIdRef: MutableRefObject<string | null>;
  paneIds: string[];
  portConflicts: Record<string, boolean>;
  selected: ServiceConfig | null;
  iconImages: Record<string, string | null>;
  displayProjectName: (groupName: string) => string;
  maskName: (service: ServiceConfig) => string;
  setDropIndicator: (indicator: DropIndicator | ((current: DropIndicator) => DropIndicator)) => void;
  setEditing: (target: EditTarget | null) => void;
  toggleGroupCollapsed: (groupName: string) => void;
  toggleProjectNamePrivacy: (groupName: string) => void;
  startGroup: (groupName: string) => void;
  stopGroup: (groupName: string) => void;
  beginDrag: (serviceId: string) => void;
  endDrag: () => void;
  reorderService: (sourceId: string, target: Exclude<DropIndicator, null>) => Promise<void>;
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
  dropIndicator,
  dragId,
  dragIdRef,
  paneIds,
  portConflicts,
  selected,
  iconImages,
  displayProjectName,
  maskName,
  setDropIndicator,
  setEditing,
  toggleGroupCollapsed,
  toggleProjectNamePrivacy,
  startGroup,
  stopGroup,
  beginDrag,
  endDrag,
  reorderService,
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
      </div>

      <div
        onDragEnter={(event) => {
          if (dragIdRef.current) event.preventDefault();
        }}
        onDragOver={(event) => {
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
            dropIndicator?.kind === "end-of-group" && dropIndicator.groupName === groupName;

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
                      className={`size-3 shrink-0 transition-transform ${collapsed ? "" : "rotate-90"}`}
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
                          if (event.shiftKey) {
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
