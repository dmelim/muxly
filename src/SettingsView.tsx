import { useEffect, useMemo, useState } from "react";
import type { AppSettings, ServiceConfig } from "./types";
import { displayServiceName, maskSensitiveName } from "./types";
import { groupServices } from "./appUtils";
import { Button } from "./Button";
import { Tooltip } from "./Tooltip";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  ChevronRightIcon,
  CloseIcon,
  DeleteIcon,
  EyeIcon,
  EyeOffIcon,
  SaveIcon,
  SearchIcon
} from "./icons";
import type { MuxlyTheme } from "./theme";
import { ThemeSettings } from "./ThemeSettings";
import { fuzzySearchMatches } from "./search";

// Bounds — must match the clamps in `src-tauri/src/settings.rs` so the form
// can show the same limits the backend will enforce on save.
const AUTO_RESTART_MAX_ATTEMPTS_LIMIT = 20;
const AUTO_RESTART_WINDOW_SECONDS_MIN = 1;
const AUTO_RESTART_WINDOW_SECONDS_MAX = 3_600;
const MAX_LOG_CHUNKS_MIN = 100;
const MAX_LOG_CHUNKS_MAX = 100_000;
const PANE_GRID_COLUMNS_MIN = 1;
const PANE_GRID_COLUMNS_MAX = 10;
type SettingsTab = "general" | "workspace" | "appearance" | "privacy";
const SETTINGS_TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "workspace", label: "Workspace" },
  { id: "appearance", label: "Appearance" },
  { id: "privacy", label: "Privacy" }
];
const SETTINGS_TAB_SECTIONS: Record<SettingsTab, string[]> = {
  general: ["Editor", "Auto-restart", "Logs"],
  workspace: ["Layout", "Profiles"],
  appearance: ["Appearance"],
  privacy: ["Privacy", "Sensitive services"]
};
const SETTINGS_SEARCH_METADATA = {
  Editor: "editor command open in editor code code.cmd nvim subl",
  "Auto-restart": "auto restart crash max attempts re-spawn window seconds budget",
  Logs: "logs output buffer max log chunks prepend timestamps hh:mm:ss",
  Layout: "layout panels panes grid columns tabs open new services split",
  Appearance: "appearance theme themes colors colours presets custom contrast terminal surfaces text accent process status feedback reset",
  Privacy: "privacy hide hidden project group names aliases stream",
  Profiles: "profiles workspace groups filter create rename delete assign unassigned",
  "Sensitive services": "sensitive services projects privacy stream hidden reveal names"
} as const;
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
  onThemePreview: (theme: MuxlyTheme | null) => void;
  // Persist the `sensitive` flag on one or more services in a single save (the
  // flag lives on the service config, not AppSettings). The Stream-mode
  // curation list below toggles a single service, or every service in a
  // project at once via the project checkbox.
  onSetServicesSensitive: (serviceIds: string[], sensitive: boolean) => Promise<void>;
  // Delete a profile: reassigns its services to unassigned, drops it from the
  // registry, and clears the active filter if it pointed there. Handled in App
  // because it touches both the service list and settings.
  onDeleteProfile: (profileId: string) => Promise<void>;
  // Whether stream mode is currently on. When it is, the sensitive curation
  // list masks the very names it controls (so the list itself doesn't leak
  // them on a shared screen), with an in-section reveal toggle to edit it.
  streamMode: boolean;
};

// Full-screen Settings surface. Shown by App in place of the terminal panes
// (between the top header and bottom drawer) when settingsOpen is true.
export function SettingsView({
  settings,
  services,
  onClose,
  onSave,
  onThemePreview,
  onSetServicesSensitive,
  onDeleteProfile,
  streamMode
}: Props) {
  const [editorCommand, setEditorCommand] = useState(settings.editorCommand);
  const [maxAttempts, setMaxAttempts] = useState(String(settings.autoRestartMaxAttempts));
  const [windowSeconds, setWindowSeconds] = useState(
    String(Math.round(settings.autoRestartWindowMs / 1000))
  );
  const [maxLogChunks, setMaxLogChunks] = useState(String(settings.maxLogChunks));
  const [paneGridColumns, setPaneGridColumns] = useState(String(settings.paneGridColumns));
  const [touchedFields, setTouchedFields] = useState<TouchedFields>(UNTOUCHED_FIELDS);
  const [settingsQuery, setSettingsQuery] = useState("");
  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const [expandedSensitiveGroups, setExpandedSensitiveGroups] = useState<
    Record<string, boolean>
  >({});
  const [pendingSensitiveServices, setPendingSensitiveServices] = useState<
    Record<string, boolean>
  >({});
  const [pendingSensitiveProjects, setPendingSensitiveProjects] = useState<
    Record<string, boolean>
  >({});
  const sectionVisible = (title: keyof typeof SETTINGS_SEARCH_METADATA) =>
    settingsQuery.trim()
      ? sectionMatches(settingsQuery, title, SETTINGS_SEARCH_METADATA[title])
      : SETTINGS_TAB_SECTIONS[activeTab].includes(title);

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
  const isServiceSensitive = (service: ServiceConfig) =>
    pendingSensitiveServices[service.id] ?? service.sensitive ?? false;

  const sensitiveCount = services.filter(isServiceSensitive).length;

  // Services grouped by project, in the same order the sidebar renders them,
  // so the curation tree mirrors the sidebar's layout.
  const groupedServices = useMemo(() => groupServices(services), [services]);

  // While stream mode is on, the list masks the names it curates. The eye
  // toggle below temporarily reveals them so the list stays editable. It
  // starts hidden each time stream mode is entered and resets when it's left,
  // after which it's purely driven by the button.
  const [revealNames, setRevealNames] = useState(false);
  useEffect(() => {
    setRevealNames(false);
  }, [streamMode]);
  // Names in this list are masked only while stream mode is on and the user
  // hasn't pressed reveal.
  const maskNames = streamMode && !revealNames;

  // Persist a single service's sensitive flag immediately (no Save button
  // needed, like the other toggles here).
  const handleSensitiveToggle = async (serviceId: string, nextSensitive: boolean) => {
    setSaveMessage(null);
    setSaving(true);
    setPendingSensitiveServices((current) => ({
      ...current,
      [serviceId]: nextSensitive
    }));
    try {
      await onSetServicesSensitive([serviceId], nextSensitive);
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingSensitiveServices((current) => {
        const next = { ...current };
        delete next[serviceId];
        return next;
      });
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
    setPendingSensitiveProjects((current) => ({
      ...current,
      [groupName]: nextSensitive
    }));
    setPendingSensitiveServices((current) => {
      const next = { ...current };
      for (const serviceId of serviceIds) next[serviceId] = nextSensitive;
      return next;
    });
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
      setPendingSensitiveProjects((current) => {
        const next = { ...current };
        delete next[groupName];
        return next;
      });
      setPendingSensitiveServices((current) => {
        const next = { ...current };
        for (const serviceId of serviceIds) delete next[serviceId];
        return next;
      });
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

  const settingsHasResults = Object.entries(SETTINGS_SEARCH_METADATA).some(
    ([title, metadata]) => sectionMatches(settingsQuery, title, metadata)
  );

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#101215]">
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">Settings</h2>
          <p className="mt-0.5 text-xs text-zinc-500">App-wide preferences. Saved on the local machine.</p>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <div className="relative w-56 max-w-[40vw]">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500" />
            <input
              value={settingsQuery}
              onChange={(event) => setSettingsQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && settingsQuery) {
                  event.preventDefault();
                  event.stopPropagation();
                  setSettingsQuery("");
                }
              }}
              aria-label="Search settings"
              placeholder="Search settings…"
              className="form-input search-input py-1.5 text-xs"
            />
            {settingsQuery ? <button type="button" onClick={() => setSettingsQuery("")} aria-label="Clear settings search" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"><CloseIcon className="size-3" /></button> : null}
          </div>
        <Tooltip label="Close (Esc)">
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close settings">
            <CloseIcon className="size-4" />
          </Button>
        </Tooltip>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <div
          className="flex w-40 shrink-0 flex-col gap-1 border-r border-white/10 bg-[#15181d] p-3"
          role="tablist"
          aria-label="Settings sections"
        >
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id && !settingsQuery}
              onClick={() => {
                setActiveTab(tab.id);
                setSettingsQuery("");
              }}
              className={`w-full rounded-md px-3 py-2 text-left text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 ${activeTab === tab.id && !settingsQuery ? "bg-cyan-400/15 text-cyan-300" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"}`}
            >
              {tab.label}
            </button>
          ))}
          {settingsQuery ? (
            <span className="px-3 pt-2 text-[11px] text-zinc-500">Searching all tabs</span>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 pb-24 pt-6">
          {!settingsHasResults ? (
            <div className="py-10 text-center">
              <p className="text-sm text-zinc-400">No settings match “{settingsQuery.trim()}”</p>
              <button type="button" onClick={() => setSettingsQuery("")} className="mt-2 text-xs text-cyan-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40">Clear search</button>
            </div>
          ) : null}
          <Section
            title="Editor"
            visible={sectionVisible("Editor")}
            description="Command used by the 'Open in editor' button on each service."
            searchQuery={settingsQuery}
            keywords={SETTINGS_SEARCH_METADATA.Editor}
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
            visible={sectionVisible("Auto-restart")}
            description="When a service crashes, Muxly can re-spawn it. A quiet period longer than the window resets the budget."
            searchQuery={settingsQuery}
            keywords={SETTINGS_SEARCH_METADATA["Auto-restart"]}
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
            visible={sectionVisible("Logs")}
            description="In-memory output buffer per service. Older chunks are dropped first."
            searchQuery={settingsQuery}
            keywords={SETTINGS_SEARCH_METADATA.Logs}
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
            visible={sectionVisible("Layout")}
            description="How open service panes are arranged on screen."
            searchQuery={settingsQuery}
            keywords={SETTINGS_SEARCH_METADATA.Layout}
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
            <label className="flex cursor-pointer items-start gap-3 pt-1">
              <input
                type="checkbox"
                checked={settings.openServicesInTabs ?? true}
                onChange={(event) => {
                  setSaveMessage(null);
                  void onSave({ ...settings, openServicesInTabs: event.target.checked }).catch(
                    (error) => setSaveMessage(error instanceof Error ? error.message : String(error))
                  );
                }}
                className="mt-0.5 size-4 cursor-pointer accent-cyan-500"
                aria-label="Open new services in tabs"
              />
              <span className="text-sm">
                <span className="block text-zinc-200">Open new services in tabs</span>
                <span className="mt-0.5 block text-xs text-zinc-500">
                  A normal click opens a tab in the focused panel. Ctrl/Cmd-click opens a separate panel with its own tabs.
                </span>
              </span>
            </label>
          </Section>

          <div
            className={
              sectionVisible("Appearance")
                ? ""
                : "hidden"
            }
          >
            <ThemeSettings settings={settings} onSave={onSave} onPreview={onThemePreview} />
          </div>

          <Section
            title="Privacy"
            visible={sectionVisible("Privacy")}
            description="Replace real project group names with persisted random aliases. Per-group toggles still live in the sidebar."
            searchQuery={settingsQuery}
            keywords={SETTINGS_SEARCH_METADATA.Privacy}
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
            title="Profiles"
            visible={sectionVisible("Profiles")}
            description="Group services into profiles (e.g. Day job, Personal) and switch the sidebar to show one at a time. A service belongs to one profile or none; unassigned services show in every profile. Assign a service to a profile when editing it."
            searchQuery={settingsQuery}
            keywords={SETTINGS_SEARCH_METADATA.Profiles}
          >
            <ProfilesSection
              settings={settings}
              services={services}
              onSave={onSave}
              onDeleteProfile={onDeleteProfile}
            />
          </Section>

          <Section
            title="Sensitive services"
            visible={sectionVisible("Sensitive services")}
            description="Mark projects and services as sensitive. While Stream mode is on (command palette — Ctrl/Cmd+P), every sensitive project and service name is hidden; This list masks those names too while Stream mode is on — use the eye button to reveal them temporarily so you can keep editing."
            searchQuery={settingsQuery}
            keywords={SETTINGS_SEARCH_METADATA["Sensitive services"]}
          >
            {services.length === 0 ? (
              <p className="text-xs text-zinc-500">No services yet.</p>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-zinc-500">
                    {sensitiveCount} / {services.length} marked sensitive.
                  </p>
                  {streamMode ? (
                    <Tooltip label={revealNames ? "Hide names" : "Reveal names to edit"}>
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => setRevealNames((value) => !value)}
                        aria-label={
                          revealNames
                            ? "Hide sensitive names again"
                            : "Reveal sensitive names to edit the list"
                        }
                        aria-pressed={revealNames}
                      >
                        {revealNames ? (
                          <EyeIcon className="size-3.5" />
                        ) : (
                          <EyeOffIcon className="size-3.5" />
                        )}
                      </Button>
                    </Tooltip>
                  ) : null}
                </div>
                <div className="space-y-2">
                  {groupedServices.map(([groupName, groupList]) => {
                    const ids = groupList.map((service) => service.id);
                    const sensitiveInGroup = groupList.filter(
                      isServiceSensitive
                    ).length;
                    const projectSensitive =
                      pendingSensitiveProjects[groupName] ??
                      settings.sensitiveProjectNames[groupName] ??
                      false;
                    // Mirror the live display: a sensitive project shows its
                    // alias while masked; a sensitive service shows its masked
                    // form. The reveal toggle flips `maskNames` off to edit.
                    const projectLabel =
                      maskNames && projectSensitive
                        ? settings.projectNameAliases[groupName] ??
                          maskSensitiveName(groupName)
                        : groupName;
                    const expanded = expandedSensitiveGroups[groupName] ?? false;
                    return (
                      <div
                        key={groupName}
                        className="overflow-hidden rounded-md border border-white/10"
                      >
                        <div className="flex items-center gap-2 bg-white/5 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={projectSensitive}
                            disabled={saving}
                            onChange={(event) =>
                              void handleProjectToggle(groupName, ids, event.target.checked)
                            }
                            className="size-4 cursor-pointer accent-cyan-500"
                            aria-label={`Mark the ${projectLabel} project and its services sensitive`}
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedSensitiveGroups((current) => ({
                                ...current,
                                [groupName]: !expanded
                              }))
                            }
                            aria-expanded={expanded}
                            aria-label={`${expanded ? "Collapse" : "Expand"} ${projectLabel} services`}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-0.5 text-left transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
                          >
                            <ChevronRightIcon
                              className={`size-3.5 shrink-0 text-zinc-500 transition-transform ${expanded ? "rotate-90" : ""}`}
                            />
                            <span className="block truncate text-xs font-semibold uppercase tracking-[0.14em] text-zinc-300">
                              {projectLabel}
                            </span>
                          </button>
                          <span className="shrink-0 text-[11px] text-zinc-500">
                            {sensitiveInGroup} / {groupList.length}
                          </span>
                        </div>
                        {expanded ? (
                          <ul className="divide-y divide-white/5">
                            {groupList.map((service) => (
                              <li key={service.id}>
                                <label className="flex cursor-pointer items-center gap-3 py-2 pl-9 pr-3 transition hover:bg-white/5">
                                  <input
                                    type="checkbox"
                                    checked={isServiceSensitive(service)}
                                    disabled={saving}
                                    onChange={(event) =>
                                      void handleSensitiveToggle(
                                        service.id,
                                        event.target.checked
                                      )
                                    }
                                    className="size-4 cursor-pointer accent-cyan-500"
                                    aria-label={`Mark ${displayServiceName(service, maskNames)} sensitive`}
                                  />
                                  <span className="min-w-0 flex-1 truncate text-sm text-zinc-200">
                                    {displayServiceName(service, maskNames)}
                                  </span>
                                </label>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </Section>

          </div>
        </div>
      </div>

      <div className="absolute bottom-5 right-6 z-20 flex items-center gap-3">
        {saveMessage ? (
          <span
            role="status"
            className="rounded-md border border-white/10 bg-[#18181b] px-3 py-2 text-xs text-zinc-300 shadow-lg"
          >
            {saveMessage}
          </span>
        ) : null}
        <Tooltip
          label={saving ? "Saving settings" : formDirty ? "Save settings" : "Settings saved"}
        >
          <Button
            variant="primary"
            size="icon"
            onClick={handleSave}
            disabled={!formDirty || saving}
            aria-label={saving ? "Saving settings" : "Save settings"}
            className="size-11 rounded-full shadow-lg"
            style={{ borderRadius: "9999px" }}
          >
            <SaveIcon className={`size-4 ${saving ? "animate-pulse" : ""}`} />
          </Button>
        </Tooltip>
      </div>
    </div>
  );
}

function Section({
  title,
  visible = true,
  description,
  searchQuery,
  keywords,
  children
}: {
  title: string;
  visible?: boolean;
  description?: string;
  searchQuery?: string;
  keywords?: string;
  children: React.ReactNode;
}) {
  if (!visible || !sectionMatches(searchQuery ?? "", title, `${description ?? ""} ${keywords ?? ""}`)) {
    return null;
  }
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

function sectionMatches(query: string, title: string, metadata: string) {
  return fuzzySearchMatches(query, [title, metadata]);
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

// Create / rename / delete the managed profiles. Create and rename are plain
// settings saves; delete is delegated to App because it also reassigns the
// profile's services to unassigned. Names must be unique (case-insensitive).
function ProfilesSection({
  settings,
  services,
  onSave,
  onDeleteProfile
}: {
  settings: AppSettings;
  services: ServiceConfig[];
  onSave: (next: AppSettings) => Promise<AppSettings>;
  onDeleteProfile: (profileId: string) => Promise<void>;
}) {
  const profiles = settings.profiles;
  const [newName, setNewName] = useState("");
  const [renameDrafts, setRenameDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Pending profile deletion awaiting confirmation in the themed modal. Holds
  // the precomputed message so the dialog stays a dumb presenter.
  const [confirmDelete, setConfirmDelete] = useState<{
    id: string;
    name: string;
    message: string;
  } | null>(null);

  // How many services are assigned to each profile id (for the row count and
  // the delete confirmation).
  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const service of services) {
      const id = service.profile?.trim();
      if (id) map[id] = (map[id] ?? 0) + 1;
    }
    return map;
  }, [services]);

  const nameTaken = (name: string, exceptId?: string) =>
    profiles.some(
      (profile) =>
        profile.id !== exceptId &&
        profile.name.trim().toLowerCase() === name.trim().toLowerCase()
    );

  const clearRenameDraft = (id: string) =>
    setRenameDrafts((drafts) => {
      const next = { ...drafts };
      delete next[id];
      return next;
    });

  const handleCreate = async () => {
    const name = newName.trim();
    setError(null);
    if (!name) return;
    if (nameTaken(name)) {
      setError(`A profile named "${name}" already exists.`);
      return;
    }
    setBusy(true);
    try {
      await onSave({
        ...settings,
        profiles: [...profiles, { id: crypto.randomUUID(), name }]
      });
      setNewName("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (id: string) => {
    const draft = renameDrafts[id];
    const existing = profiles.find((profile) => profile.id === id);
    if (draft === undefined || !existing) return;
    const name = draft.trim();
    if (name === existing.name) {
      clearRenameDraft(id);
      return;
    }
    setError(null);
    if (!name) {
      setError("Profile name can't be empty.");
      return;
    }
    if (nameTaken(name, id)) {
      setError(`A profile named "${name}" already exists.`);
      return;
    }
    setBusy(true);
    try {
      await onSave({
        ...settings,
        profiles: profiles.map((profile) =>
          profile.id === id ? { ...profile, name } : profile
        )
      });
      clearRenameDraft(id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  // Open the themed confirmation modal for a delete. The actual delete runs in
  // `performDelete` once the user confirms.
  const requestDelete = (id: string, name: string) => {
    const count = counts[id] ?? 0;
    const message =
      count > 0
        ? `Delete profile "${name}"? Its ${count} service${
            count === 1 ? "" : "s"
          } will become unassigned (shown in every profile). The services themselves are not deleted.`
        : `Delete profile "${name}"?`;
    setError(null);
    setConfirmDelete({ id, name, message });
  };

  const performDelete = async () => {
    if (!confirmDelete) return;
    const { id } = confirmDelete;
    setError(null);
    setBusy(true);
    try {
      await onDeleteProfile(id);
      setConfirmDelete(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      // Dismiss the modal so the inline error below the list is visible.
      setConfirmDelete(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(event) => {
            setNewName(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleCreate();
            }
          }}
          className="form-input flex-1 text-sm"
          placeholder="New profile name (e.g. Day job)"
          aria-label="New profile name"
          disabled={busy}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void handleCreate()}
          disabled={busy || !newName.trim()}
        >
          Add profile
        </Button>
      </div>

      {profiles.length === 0 ? (
        <p className="text-xs text-zinc-500">
          No profiles yet. Add one above to start separating services.
        </p>
      ) : (
        <ul className="divide-y divide-white/10">
          {profiles.map((profile) => {
            const draft = renameDrafts[profile.id] ?? profile.name;
            const count = counts[profile.id] ?? 0;
            return (
              <li
                key={profile.id}
                className="flex items-center gap-2 py-2"
              >
                <input
                  value={draft}
                  onChange={(event) =>
                    setRenameDrafts((drafts) => ({
                      ...drafts,
                      [profile.id]: event.target.value
                    }))
                  }
                  onBlur={() => void handleRename(profile.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      (event.target as HTMLInputElement).blur();
                    }
                    if (event.key === "Escape") {
                      clearRenameDraft(profile.id);
                    }
                  }}
                  className="form-input min-w-0 flex-1 text-sm"
                  aria-label={`Rename profile ${profile.name}`}
                  disabled={busy}
                />
                <span className="shrink-0 text-[11px] text-zinc-500">
                  {count} service{count === 1 ? "" : "s"}
                </span>
                <Tooltip label={`Delete ${profile.name}`}>
                  <Button
                    variant="destructive"
                    size="icon"
                    onClick={() => requestDelete(profile.id, profile.name)}
                    disabled={busy}
                    aria-label={`Delete profile ${profile.name}`}
                  >
                    <DeleteIcon className="size-4" />
                  </Button>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}

      {error ? (
        <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>
      ) : null}

      {confirmDelete ? (
        <ConfirmDialog
          title="Delete profile"
          message={confirmDelete.message}
          confirmLabel="Delete"
          destructive
          busy={busy}
          onConfirm={() => void performDelete()}
          onClose={() => setConfirmDelete(null)}
        />
      ) : null}
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
