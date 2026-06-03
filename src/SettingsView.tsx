import { useEffect, useMemo, useState } from "react";
import type { AppSettings, ServiceConfig } from "./types";
import { groupServices } from "./appUtils";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";
import { CloseIcon } from "./icons";

// Bounds — must match the clamps in `src-tauri/src/settings.rs` so the form
// can show the same limits the backend will enforce on save.
const AUTO_RESTART_MAX_ATTEMPTS_LIMIT = 20;
const AUTO_RESTART_WINDOW_SECONDS_MIN = 1;
const AUTO_RESTART_WINDOW_SECONDS_MAX = 3_600;
const MAX_LOG_CHUNKS_MIN = 100;
const MAX_LOG_CHUNKS_MAX = 100_000;
const PANE_GRID_COLUMNS_MIN = 1;
const PANE_GRID_COLUMNS_MAX = 10;
const UNTOUCHED_FIELDS = {
  editorCommand: false,
  maxAttempts: false,
  windowSeconds: false,
  maxLogChunks: false,
  paneGridColumns: false
};

type TouchedFields = typeof UNTOUCHED_FIELDS;

type Props = {
  settings: AppSettings;
  // Live list of services — used to compute the "all hidden" state and to
  // know which group names exist when toggling the master privacy switch.
  services: ServiceConfig[];
  onClose: () => void;
  // Returns the persisted settings (possibly clamped by the backend) so the
  // form can re-sync to authoritative values after save.
  onSave: (next: AppSettings) => Promise<AppSettings>;
  // Persist the `sensitive` flag on one or more services in a single save (the
  // flag lives on the service config, not AppSettings). The Stream-mode
  // curation list below toggles a single service, or every service in a
  // project at once via the project checkbox.
  onSetServicesSensitive: (serviceIds: string[], sensitive: boolean) => Promise<void>;
};

// Full-screen Settings surface. Shown by App in place of the terminal panes
// (between the top header and bottom drawer) when settingsOpen is true.
export function SettingsView({ settings, services, onClose, onSave, onSetServicesSensitive }: Props) {
  const [editorCommand, setEditorCommand] = useState(settings.editorCommand);
  const [maxAttempts, setMaxAttempts] = useState(String(settings.autoRestartMaxAttempts));
  const [windowSeconds, setWindowSeconds] = useState(
    String(Math.round(settings.autoRestartWindowMs / 1000))
  );
  const [maxLogChunks, setMaxLogChunks] = useState(String(settings.maxLogChunks));
  const [paneGridColumns, setPaneGridColumns] = useState(String(settings.paneGridColumns));
  const [touchedFields, setTouchedFields] = useState<TouchedFields>(UNTOUCHED_FIELDS);

  // Keep untouched form fields aligned with async settings loads, while still
  // preserving in-progress edits when other settings (like privacy) are saved.
  useEffect(() => {
    if (!touchedFields.editorCommand) {
      setEditorCommand(settings.editorCommand);
    }
    if (!touchedFields.maxAttempts) {
      setMaxAttempts(String(settings.autoRestartMaxAttempts));
    }
    if (!touchedFields.windowSeconds) {
      setWindowSeconds(String(Math.round(settings.autoRestartWindowMs / 1000)));
    }
    if (!touchedFields.maxLogChunks) {
      setMaxLogChunks(String(settings.maxLogChunks));
    }
    if (!touchedFields.paneGridColumns) {
      setPaneGridColumns(String(settings.paneGridColumns));
    }
  }, [settings, touchedFields]);

  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The unique group names currently in use, derived the same way the sidebar
  // does (group string trimmed, empty → "Ungrouped"). The "hide all" toggle
  // operates on this set.
  const groupNames = useMemo(() => {
    const seen = new Set<string>();
    for (const service of services) {
      const key = service.group?.trim() || "Ungrouped";
      seen.add(key);
    }
    return Array.from(seen);
  }, [services]);

  const allHidden =
    groupNames.length > 0 &&
    groupNames.every((name) => settings.hiddenProjectNames[name] === true);

  const handleSave = async () => {
    setSaveMessage(null);
    const parsedAttempts = parseInteger(maxAttempts);
    const parsedWindow = parseInteger(windowSeconds);
    const parsedLog = parseInteger(maxLogChunks);
    const parsedCols = parseInteger(paneGridColumns);
    if (
      parsedAttempts == null ||
      parsedWindow == null ||
      parsedLog == null ||
      parsedCols == null
    ) {
      setSaveMessage("All numeric fields must be whole numbers.");
      return;
    }

    const next: AppSettings = {
      ...settings,
      editorCommand,
      autoRestartMaxAttempts: clamp(parsedAttempts, 0, AUTO_RESTART_MAX_ATTEMPTS_LIMIT),
      autoRestartWindowMs:
        clamp(
          parsedWindow,
          AUTO_RESTART_WINDOW_SECONDS_MIN,
          AUTO_RESTART_WINDOW_SECONDS_MAX
        ) * 1000,
      maxLogChunks: clamp(parsedLog, MAX_LOG_CHUNKS_MIN, MAX_LOG_CHUNKS_MAX),
      paneGridColumns: clamp(parsedCols, PANE_GRID_COLUMNS_MIN, PANE_GRID_COLUMNS_MAX)
    };

    setSaving(true);
    try {
      const saved = await onSave(next);
      // Re-sync from the backend's view of the truth — backend clamps may
      // differ from what the user typed (e.g. "999" attempts → 20).
      setEditorCommand(saved.editorCommand);
      setMaxAttempts(String(saved.autoRestartMaxAttempts));
      setWindowSeconds(String(Math.round(saved.autoRestartWindowMs / 1000)));
      setMaxLogChunks(String(saved.maxLogChunks));
      setPaneGridColumns(String(saved.paneGridColumns));
      setTouchedFields(UNTOUCHED_FIELDS);
      setSaveMessage("Saved");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  // Toggle every existing group's privacy in one call. We always set explicit
  // booleans (rather than deleting keys when un-hiding) so the UI reflects an
  // intentional "shown" state instead of falling back to an undefined default.
  const handleHideAllToggle = async () => {
    setSaveMessage(null);
    const nextHidden: Record<string, boolean> = { ...settings.hiddenProjectNames };
    const target = !allHidden;
    for (const name of groupNames) {
      nextHidden[name] = target;
    }
    setSaving(true);
    try {
      await onSave({ ...settings, hiddenProjectNames: nextHidden });
      setSaveMessage(target ? "All project names hidden" : "All project names shown");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  // Number of services currently flagged sensitive — drives the summary line.
  const sensitiveCount = useMemo(
    () => services.filter((service) => service.sensitive).length,
    [services]
  );

  // Services grouped by project, in the same order the sidebar renders them,
  // so the curation tree mirrors the sidebar's layout.
  const groupedServices = useMemo(() => groupServices(services), [services]);

  // Persist a single service's sensitive flag immediately (no Save button
  // needed, like the other toggles here).
  const handleSensitiveToggle = async (serviceId: string, nextSensitive: boolean) => {
    setSaveMessage(null);
    setSaving(true);
    try {
      await onSetServicesSensitive([serviceId], nextSensitive);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  // The project checkbox flags the project sensitive (`sensitiveProjectNames`)
  // — its own state, separate from the manual sidebar hide toggle. While stream
  // mode is on, a sensitive project's name is hidden. Toggling it also
  // marks/unmarks every service under it as a convenience; after that the
  // project flag and the per-service flags move independently.
  const handleProjectToggle = async (
    groupName: string,
    serviceIds: string[],
    nextSensitive: boolean
  ) => {
    setSaveMessage(null);
    setSaving(true);
    try {
      await onSetServicesSensitive(serviceIds, nextSensitive);
      await onSave({
        ...settings,
        sensitiveProjectNames: {
          ...settings.sensitiveProjectNames,
          [groupName]: nextSensitive
        }
      });
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  // Detect form dirtiness so the Save button can disable cleanly when the
  // visible values match the persisted ones.
  const formDirty =
    (touchedFields.editorCommand && editorCommand.trim() !== settings.editorCommand) ||
    (touchedFields.maxAttempts && maxAttempts !== String(settings.autoRestartMaxAttempts)) ||
    (touchedFields.windowSeconds &&
      windowSeconds !== String(Math.round(settings.autoRestartWindowMs / 1000))) ||
    (touchedFields.maxLogChunks && maxLogChunks !== String(settings.maxLogChunks)) ||
    (touchedFields.paneGridColumns &&
      paneGridColumns !== String(settings.paneGridColumns));

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#101215]">
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">Settings</h2>
          <p className="mt-0.5 text-xs text-zinc-500">App-wide preferences. Saved on the local machine.</p>
        </div>
        <Tooltip label="Close (Esc)">
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close settings">
            <CloseIcon className="size-4" />
          </Button>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-6">
          <Section
            title="Editor"
            description="Command used by the 'Open in editor' button on each service."
          >
            <FormRow label="Editor command" hint='e.g. "code" or "code.cmd" on Windows, "nvim", "subl"'>
              <input
                value={editorCommand}
                onChange={(event) => {
                  setTouchedFields((current) => ({ ...current, editorCommand: true }));
                  setEditorCommand(event.target.value);
                  setSaveMessage(null);
                }}
                className="form-input font-mono text-xs"
                placeholder="code"
                aria-label="Editor command"
              />
            </FormRow>
          </Section>

          <Section
            title="Auto-restart"
            description="When a service crashes, Muxly can re-spawn it. A quiet period longer than the window resets the budget."
          >
            <FormRow
              label="Max attempts"
              hint={`How many times to re-spawn within the window. 0 disables auto-restart. Max ${AUTO_RESTART_MAX_ATTEMPTS_LIMIT}.`}
            >
              <input
                type="number"
                min={0}
                max={AUTO_RESTART_MAX_ATTEMPTS_LIMIT}
                value={maxAttempts}
                onChange={(event) => {
                  setTouchedFields((current) => ({ ...current, maxAttempts: true }));
                  setMaxAttempts(event.target.value);
                  setSaveMessage(null);
                }}
                className="form-input w-32 font-mono text-xs"
                aria-label="Max auto-restart attempts"
              />
            </FormRow>
            <FormRow
              label="Window (seconds)"
              hint={`${AUTO_RESTART_WINDOW_SECONDS_MIN}–${AUTO_RESTART_WINDOW_SECONDS_MAX} seconds.`}
            >
              <input
                type="number"
                min={AUTO_RESTART_WINDOW_SECONDS_MIN}
                max={AUTO_RESTART_WINDOW_SECONDS_MAX}
                value={windowSeconds}
                onChange={(event) => {
                  setTouchedFields((current) => ({ ...current, windowSeconds: true }));
                  setWindowSeconds(event.target.value);
                  setSaveMessage(null);
                }}
                className="form-input w-32 font-mono text-xs"
                aria-label="Auto-restart window in seconds"
              />
            </FormRow>
          </Section>

          <Section
            title="Logs"
            description="In-memory output buffer per service. Older chunks are dropped first."
          >
            <FormRow
              label="Max log chunks"
              hint={`${MAX_LOG_CHUNKS_MIN.toLocaleString()}–${MAX_LOG_CHUNKS_MAX.toLocaleString()} chunks. Each chunk is one write from the underlying process.`}
            >
              <input
                type="number"
                min={MAX_LOG_CHUNKS_MIN}
                max={MAX_LOG_CHUNKS_MAX}
                value={maxLogChunks}
                onChange={(event) => {
                  setTouchedFields((current) => ({ ...current, maxLogChunks: true }));
                  setMaxLogChunks(event.target.value);
                  setSaveMessage(null);
                }}
                className="form-input w-40 font-mono text-xs"
                aria-label="Max log chunks per service"
              />
            </FormRow>
            <label className="flex cursor-pointer items-start gap-3 pt-1">
              <input
                type="checkbox"
                checked={settings.showTimestamps}
                onChange={(event) => {
                  setSaveMessage(null);
                  void onSave({ ...settings, showTimestamps: event.target.checked }).catch(
                    (error) => {
                      setSaveMessage(
                        error instanceof Error ? error.message : String(error)
                      );
                    }
                  );
                }}
                className="mt-0.5 size-4 cursor-pointer accent-cyan-500"
                aria-label="Prepend timestamps to log lines"
              />
              <span className="text-sm">
                <span className="block text-zinc-200">Prepend timestamps</span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  Adds a dim <code className="font-mono">[HH:MM:SS]</code>{" "}
                  marker to the start of every line of service output. Applies
                  to new output only — existing log lines keep whatever marker
                  (or lack of one) they had when they arrived.
                </span>
              </span>
            </label>
          </Section>

          <Section
            title="Layout"
            description="How open service panes are arranged on screen."
          >
            <FormRow
              label="Pane grid columns"
              hint={`Max panes per row before wrapping to a new row. ${PANE_GRID_COLUMNS_MIN}–${PANE_GRID_COLUMNS_MAX}.`}
            >
              <input
                type="number"
                min={PANE_GRID_COLUMNS_MIN}
                max={PANE_GRID_COLUMNS_MAX}
                value={paneGridColumns}
                onChange={(event) => {
                  setTouchedFields((current) => ({ ...current, paneGridColumns: true }));
                  setPaneGridColumns(event.target.value);
                  setSaveMessage(null);
                }}
                className="form-input w-32 font-mono text-xs"
                aria-label="Max pane grid columns"
              />
            </FormRow>
          </Section>

          <Section
            title="Privacy"
            description="Replace real project group names with persisted random aliases. Per-group toggles still live in the sidebar."
          >
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={allHidden}
                onChange={handleHideAllToggle}
                disabled={saving || groupNames.length === 0}
                className="mt-0.5 size-4 cursor-pointer accent-cyan-500"
                aria-label="Hide all project names"
              />
              <span className="text-sm">
                <span className="block text-zinc-200">Hide all project names</span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  {groupNames.length === 0
                    ? "No groups yet — add a service to a group first."
                    : `Currently ${
                        groupNames.filter((name) => settings.hiddenProjectNames[name]).length
                      } / ${groupNames.length} hidden.`}
                </span>
              </span>
            </label>
          </Section>

          <Section
            title="Sensitive services"
            description="Mark projects and services as sensitive. While Stream mode is on (toggle it from the command palette — Ctrl/Cmd+P), every sensitive project name is hidden (shown as its alias) and every sensitive service name is masked to its last 3 characters; turning Stream mode off reveals them again. This is independent of the sidebar eye toggle, which hides a project name manually regardless of Stream mode. Checking a project also marks all its services as a convenience; you can then uncheck individual services without affecting the project."
          >
            {services.length === 0 ? (
              <p className="text-xs text-zinc-500">No services yet.</p>
            ) : (
              <>
                <p className="text-[11px] text-zinc-500">
                  {sensitiveCount} / {services.length} marked sensitive.
                </p>
                <div className="space-y-2">
                  {groupedServices.map(([groupName, groupList]) => {
                    const ids = groupList.map((service) => service.id);
                    const sensitiveInGroup = groupList.filter(
                      (service) => service.sensitive
                    ).length;
                    const projectSensitive =
                      settings.sensitiveProjectNames[groupName] ?? false;
                    return (
                      <div
                        key={groupName}
                        className="overflow-hidden rounded-md border border-white/10"
                      >
                        <label className="flex cursor-pointer items-center gap-3 bg-white/5 px-3 py-2 transition hover:bg-white/10">
                          <input
                            type="checkbox"
                            checked={projectSensitive}
                            disabled={saving}
                            onChange={(event) =>
                              void handleProjectToggle(groupName, ids, event.target.checked)
                            }
                            className="size-4 cursor-pointer accent-cyan-500"
                            aria-label={`Mark the ${groupName} project and its services sensitive`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300">
                              {groupName}
                            </span>
                          </span>
                          <span className="shrink-0 text-[11px] text-zinc-500">
                            {sensitiveInGroup} / {groupList.length}
                          </span>
                        </label>
                        <ul className="divide-y divide-white/5">
                          {groupList.map((service) => (
                            <li key={service.id}>
                              <label className="flex cursor-pointer items-center gap-3 py-2 pl-9 pr-3 transition hover:bg-white/5">
                                <input
                                  type="checkbox"
                                  checked={service.sensitive ?? false}
                                  disabled={saving}
                                  onChange={(event) =>
                                    void handleSensitiveToggle(
                                      service.id,
                                      event.target.checked
                                    )
                                  }
                                  className="size-4 cursor-pointer accent-cyan-500"
                                  aria-label={`Mark ${service.name} sensitive`}
                                />
                                <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                                  {service.name}
                                </span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Section>

        </div>
      </div>

      {/*
        Footer is a sibling of the scroll area (not inside it) so it sits at
        the actual bottom of the Settings panel regardless of how tall the
        form is. The header's X already handles "close", so the footer only
        carries Save + save status.
      */}
      <div className="flex items-center justify-end gap-3 border-t border-white/10 bg-[#15181d] px-6 py-3">
        {saveMessage ? (
          <span className="mr-auto text-xs text-zinc-400">{saveMessage}</span>
        ) : null}
        <Button
          variant="primary"
          size="sm"
          onClick={handleSave}
          disabled={!formDirty || saving}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function Section({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-white/10 bg-[#15181d] p-5">
      <header className="mb-4">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        {description ? <p className="mt-1 text-xs text-zinc-500">{description}</p> : null}
      </header>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function FormRow({
  label,
  hint,
  children
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label className="text-xs uppercase tracking-[0.14em] text-zinc-500">{label}</label>
      {children}
      {hint ? <p className="text-[11px] text-zinc-500">{hint}</p> : null}
    </div>
  );
}

function parseInteger(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
  return parsed;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
