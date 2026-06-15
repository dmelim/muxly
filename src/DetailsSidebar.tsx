import type { AppSettings, ServiceConfig, ServiceHistory, ServiceStatus } from "./types";
import type { EditTarget } from "./appTypes";
import { formatCommand } from "./types";
import { Button } from "./Button";
import { Detail } from "./Detail";
import { ImportPanel } from "./ImportPanel";
import { ServiceForm } from "./ServiceForm";
import { ServiceIconBadge } from "./ServiceIconBadge";
import { groupKey, statusLabels, timeAgo } from "./appUtils";
import { openInEditor, openInFileManager, openServiceUrl } from "./appActions";

type Props = {
  editing: EditTarget | null;
  services: ServiceConfig[];
  selected: ServiceConfig | null;
  settings: AppSettings;
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
  statuses,
  pids,
  actualPorts,
  adoptedPids,
  lastExit,
  history,
  iconImages,
  displayProjectName,
  appendLog,
  onImport,
  onSaveService,
  onDeleteService,
  onEdit
}: Props) {
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
        initial={editing.mode === "edit" ? editing.service : null}
        existingIds={services
          .filter((service) => editing.mode !== "edit" || service.id !== editing.service.id)
          .map((service) => service.id)}
        onSave={onSaveService}
        onCancel={() => onEdit(null)}
        onDelete={
          editing.mode === "edit" ? () => onDeleteService(editing.service) : undefined
        }
      />
    );
  }

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
              {actualPorts[selected.id] ?? selected.port ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    openServiceUrl(
                      (actualPorts[selected.id] ?? selected.port)!,
                      selected.id,
                      appendLog
                    )
                  }
                >
                  Open localhost:{actualPorts[selected.id] ?? selected.port}
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
              <Detail label="Status">
                {adoptedPids[selected.id]
                  ? `Adopted (external pid ${adoptedPids[selected.id].pid})`
                  : statusLabels[statuses[selected.id] ?? "stopped"]}
              </Detail>
              <Detail label="PID">
                {pids[selected.id] ?? adoptedPids[selected.id]?.pid ?? "None"}
              </Detail>
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
              <Detail label="Options">
                <EnabledOptions service={selected} />
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
          <p className="p-5 text-sm text-zinc-500">
            No service selected. Use "+ New service" in the sidebar to create one.
          </p>
        )}
      </div>
    </>
  );
}

// Lists only the service's enabled option flags, each as green text. Disabled
// flags are omitted entirely; when none are on we fall back to a dim "None" so
// the row never reads as missing data.
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
        <li key={label} className="text-xs text-emerald-400">
          {label}
        </li>
      ))}
    </ul>
  );
}
