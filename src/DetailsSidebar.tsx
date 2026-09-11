import { useMemo } from "react";
﻿import type { AppSettings, ServiceConfig, ServiceHistory, ServiceStatus } from "./types";
import type { EditTarget } from "./appTypes";
import type { EditorCandidate } from "./types";
import { displayServiceName, formatCommand, redactSensitive } from "./types";
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
import { EditorLogo } from "./EditorLogo";
import { EditIcon, FolderOpenIcon, GlobeIcon } from "./icons";
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
    icon: <EditorLogo command={option.value} label={option.label} className="size-3.5" />
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
<div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-3"><h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{selected ? displayServiceName(selected, streamMode) : "Details"}</h2>{selected ? (            <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
              <Dropdown
                compact
                variant="toolbar"
                value={settings.editorCommand}
                options={editorOptions}
                onChange={(command) =>
                  void openInEditor(selected.cwd, selected.id, command, appendLog)
                }
                primaryAction={{
                  label: "Open service in configured editor",
                  onClick: () => void openInEditor(selected.cwd, selected.id, settings.editorCommand, appendLog)
                }}
                ariaLabel="Choose editor to open service"
                placeholder="Editor"
                tooltip="Choose editor to open service"
                showSelectionIndicator={false}
                className="shrink-0"
              />
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
            <Tooltip label="Edit service"><Button variant="ghost" size="icon" aria-label="Edit service" onClick={() => onEdit({ mode: "edit", service: selected })}><EditIcon className="size-4" /></Button></Tooltip></div>
) : null}</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selected ? (
          <div className="space-y-5 p-3 text-sm">
            <dl className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,110px),1fr))] gap-x-4 gap-y-3">
              <Detail label="Icon">
                <ServiceIconBadge
                  service={selected}
                  imageSrc={iconImages[selected.id]}
                  status={statuses[selected.id] ?? "stopped"}
                  large
                />
              </Detail>
              <Detail label="Status" className="min-w-0">
                <span className="[overflow-wrap:anywhere]">
                  {adoptedPids[selected.id]
                    ? `Adopted (external pid ${adoptedPids[selected.id].pid})`
                    : statusLabels[statuses[selected.id] ?? "stopped"]}
                </span>
              </Detail>
              <Detail label="PID">
                {pids[selected.id] ?? adoptedPids[selected.id]?.pid ?? "None"}
              </Detail>
              <Detail label="Last exit">{lastExit[selected.id] ?? "None"}</Detail>
              <Detail label="Command" className="col-span-full min-w-0">
                <span className="block min-w-0 max-w-full rounded-md bg-black/20 p-3 font-mono text-xs text-zinc-300 [overflow-wrap:anywhere]">
                  {redact(formatCommand(selected))}
                </span>
              </Detail>
              <Detail label="Working directory" className="col-span-full min-w-0">
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
              <GitSection
                key={selected.id}
                service={selected}
                privateMode={streamMode && Boolean(selected.sensitive)}
              />
            </dl>

            <section aria-labelledby="run-history-heading" className="pt-4">
              <h3 id="run-history-heading" className="text-sm font-semibold text-zinc-100">Run history</h3>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                <Detail label="Total runs">{history[selected.id]?.totalRuns ?? 0}</Detail>
                <Detail label="Failed">{history[selected.id]?.failedRuns ?? 0}</Detail>
                <Detail label="Last run">{timeAgo(history[selected.id]?.lastStartedAt ?? null)}</Detail>
                <Detail label="Last failure">
                  {timeAgo(history[selected.id]?.lastFailureAt ?? null)}
                </Detail>
              </dl>
            </section>
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
