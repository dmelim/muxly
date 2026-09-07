import { useMemo } from "react";
﻿import type { AppSettings, ServiceConfig, ServiceHistory, ServiceStatus } from "./types";
import type { EditTarget } from "./appTypes";
import type { EditorCandidate } from "./types";
import { formatCommand, redactSensitive } from "./types";
import { Button } from "./Button";
import { Detail } from "./Detail";
import { ImportPanel } from "./ImportPanel";
import { ServiceForm } from "./ServiceForm";
import { ServiceIconBadge } from "./ServiceIconBadge";
import { groupKey, statusLabels, timeAgo } from "./appUtils";
import { GitSection } from "./GitSection";
import { openInEditor, openInFileManager, openServiceUrl } from "./appActions";
import { Dropdown } from "./Dropdown";
import { buildEditorOptions } from "./editorOptions";
import { CodeIcon, FolderOpenIcon, GlobeIcon } from "./icons";
import { Tooltip } from "./Tooltip";

type Props = {
  editing: EditTarget | null;
  services: ServiceConfig[];
  selected: ServiceConfig | null;
  settings: AppSettings;
  // The active profile id (or null) — used to pre-select the profile for a new
  // service created while a profile is active.
  activeProfile: string | null;
  // When true, sensitive services have their paths/names redacted in this panel
  // (stream mode), the same as the terminal logs.
  streamMode: boolean;
  // Project group name → stable alias, used for the redaction above.
  projectNameAliases: Record<string, string>;
  statuses: Record<string, ServiceStatus>;
  pids: Record<string, number>;
  // The port a running service actually bound to. For an auto-port service this
  // may differ from `service.port` (the preference); used to label/link the
  // real port while it's running.
  actualPorts: Record<string, number>;
  adoptedPids: Record<string, { pid: number; port: number }>;
  lastExit: Record<string, string>;
  history: Record<string, ServiceHistory>;
  iconImages: Record<string, string | null>;
  detectedEditors: EditorCandidate[];
  editorDiscoveryLoading: boolean;
  editorDiscoveryError: string | null;
  displayProjectName: (groupName: string) => string;
  appendLog: (id: string, chunk: string) => void;
  onImport: (services: ServiceConfig[]) => Promise<void>;
  onSaveService: (service: ServiceConfig) => Promise<void>;
  onDeleteService: (service: ServiceConfig) => Promise<void>;
  onEdit: (editing: EditTarget | null) => void;
};

export function DetailsSidebar({
  editing,
  services,
  selected,
  settings,
  activeProfile,
  streamMode,
  projectNameAliases,
  statuses,
  pids,
  actualPorts,
  adoptedPids,
  lastExit,
  history,
  iconImages,
  detectedEditors,
  editorDiscoveryLoading,
  editorDiscoveryError,
  displayProjectName,
  appendLog,
  onImport,
  onSaveService,
  onDeleteService,
  onEdit
}: Props) {
  const editorOptions = useMemo(() => buildEditorOptions(
    detectedEditors,
    settings.customEditors,
    settings.editorCommand
  ).map((option) => ({
    ...option,
    icon: <CodeIcon className="size-3.5" />
  })), [detectedEditors, settings.customEditors, settings.editorCommand]);

  if (editing?.mode === "import") {
    return (
      <ImportPanel
        existingIds={services.map((service) => service.id)}
        onImport={onImport}
        onCancel={() => onEdit(null)}
      />
    );
  }

  if (editing) {
    return (
      <ServiceForm
        key={`${editing.mode}-${"service" in editing && editing.service ? editing.service.id : "blank"}`}
        initial={"service" in editing ? editing.service ?? null : null}
        existingIds={services
          .filter((service) => editing.mode !== "edit" || service.id !== editing.service.id)
          .map((service) => service.id)}
        profiles={settings.profiles}
        defaultProfile={editing.mode === "new" && !editing.service ? activeProfile : null}
        onSave={onSaveService}
        onCancel={() => onEdit(null)}
        onDelete={
          editing.mode === "edit" ? () => onDeleteService(editing.service) : undefined
        }
      />
    );
  }

  // Redact sensitive paths/names in the read-only detail rows while stream mode
  // is on, matching the terminal logs. No-op unless the selected service is
  // flagged sensitive.
  const alias = selected ? projectNameAliases[groupKey(selected)] ?? "" : "";
  const redact = (text: string) =>
    selected ? redactSensitive(text, selected, alias, streamMode) : text;
  const selectedPort = selected ? actualPorts[selected.id] ?? selected.port : null;
  const hasValidPort =
    typeof selectedPort === "number" && Number.isInteger(selectedPort) && selectedPort > 0 && selectedPort <= 65535;

  return (
    <>
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <h2 className="text-sm font-semibold">Details</h2>
        {selected ? (
          <Button variant="ghost" size="xs" onClick={() => onEdit({ mode: "edit", service: selected })}>
            Edit
          </Button>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <div className="space-y-5 p-5 text-sm">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Tooltip label="Open service in editor" side="top">
                <Dropdown
                  compact
                  variant="toolbar"
                  value={settings.editorCommand}
                  options={editorOptions}
                  onChange={(command) =>
                    void openInEditor(selected.cwd, selected.id, command, appendLog)
                  }
                  ariaLabel="Open service in editor"
                  placeholder="Editor"
                  className="shrink-0"
                />
              </Tooltip>
              <span className="sr-only" aria-live="polite">
                {editorDiscoveryLoading
                  ? "Scanning for installed editors"
                  : editorDiscoveryError
                  ? "Editor scan unavailable; saved editor remains available"
                  : ""}
              </span>
              <Tooltip label="Open service folder" side="top">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openInFileManager(selected.cwd, selected.id, appendLog)}
                  aria-label="Open service folder"
                >
                  <FolderOpenIcon className="size-4" />
                </Button>
              </Tooltip>
              {hasValidPort ? (
                <Tooltip label={`Open localhost:${selectedPort} in browser`} side="top">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openServiceUrl(selectedPort!, selected.id, appendLog)}
                    aria-label={`Open localhost:${selectedPort} in browser`}
                  >
                    <GlobeIcon className="size-4" />
                  </Button>
                </Tooltip>
              ) : null}
            </div>
            <dl className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,110px),1fr))] gap-x-4 gap-y-3">
              <Detail label="Icon">
                <ServiceIconBadge
                  service={selected}
                  imageSrc={iconImages[selected.id]}
                  status={statuses[selected.id] ?? "stopped"}
                  large
                />
              </Detail>
              <Detail label="Status" className="col-span-full min-w-0">
                <span className="[overflow-wrap:anywhere]">
                  {adoptedPids[selected.id]
                    ? `Adopted (external pid ${adoptedPids[selected.id].pid})`
                    : statusLabels[statuses[selected.id] ?? "stopped"]}
                </span>
              </Detail>
              <Detail label="PID">
                {pids[selected.id] ?? adoptedPids[selected.id]?.pid ?? "None"}
              </Detail>
              <Detail label="Last Exit">{lastExit[selected.id] ?? "None"}</Detail>
              <Detail label="Command" className="col-span-full min-w-0">
                <span className="block min-w-0 max-w-full rounded-md bg-black/20 p-3 font-mono text-xs text-zinc-300 [overflow-wrap:anywhere]">
                  {redact(formatCommand(selected))}
                </span>
              </Detail>
              <Detail label="Working Dir" className="col-span-full min-w-0">
                <span className="font-mono text-xs text-zinc-300 [overflow-wrap:anywhere]">
                  {redact(selected.cwd)}
                </span>
              </Detail>
              <Detail label="Group">
                {selected.group
                  ? streamMode && selected.sensitive && alias
                    ? alias
                    : displayProjectName(groupKey(selected))
                  : "None"}
              </Detail>
              <Detail label="Profile">
                {settings.profiles.find((profile) => profile.id === selected.profile)?.name ??
                  "None"}
              </Detail>
              <Detail label="Port">
                {actualPorts[selected.id] != null && actualPorts[selected.id] !== selected.port
                  ? `${actualPorts[selected.id]} (auto, prefers ${selected.port ?? "any"})`
                  : selected.autoPort
                  ? `${selected.port ?? "any"} (auto-roll)`
                  : selected.port ?? "None"}
              </Detail>
              <Detail label="Env">
                {Object.keys(selected.env).length === 0
                  ? "None"
                  : `${Object.keys(selected.env).length} variables`}
              </Detail>
              <Detail label="Options" className="col-span-full min-w-0">
                <EnabledOptions service={selected} />
              </Detail>
              <Detail label="Repository" className="col-span-full min-w-0">
                <GitSection
                  key={selected.id}
                  service={selected}
                  privateMode={streamMode && Boolean(selected.sensitive)}
                />
              </Detail>
            </dl>

            <div className="pt-5">
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
          <p className="p-5 text-sm text-zinc-500">
            No service selected. Use "+ New service" in the sidebar to create one.
          </p>
        )}
      </div>
    </>
  );
}

// Lists only the service's enabled option flags, each in the brand cyan accent.
// Disabled flags are omitted entirely; when none are on we fall back to a dim
// "None" so the row never reads as missing data.
function EnabledOptions({ service }: { service: ServiceConfig }) {
  const enabled = [
    service.autoPort && "Auto-roll port if busy",
    service.autoRestart && "Auto-restart on crash",
    service.usePty && "Run in pseudo-terminal",
    service.sensitive && "Sensitive name"
  ].filter((label): label is string => Boolean(label));

  if (enabled.length === 0) {
    return <span className="text-zinc-500">None</span>;
  }

  return (
    <ul className="mt-0.5 space-y-1">
      {enabled.map((label) => (
        <li key={label} className="text-xs text-cyan-400">
          {label}
        </li>
      ))}
    </ul>
  );
}
