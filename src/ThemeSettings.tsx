import { useEffect, useMemo, useState } from "react";
import type { AppSettings } from "./types";
import {
  contrastRatio,
  DEFAULT_THEME,
  resolveTheme,
  THEME_PRESETS,
  type MuxlyTheme,
  type ThemePresetId
} from "./theme";
import { Button } from "./Button";
import { ColorPicker } from "./ColorPicker";
import { Dropdown } from "./Dropdown";

const GROUPS: Array<{ title: string; keys: Array<keyof MuxlyTheme> }> = [
  { title: "Surfaces", keys: ["appBackground", "surfaceBackground", "elevatedBackground", "border", "hoverSubtle", "hoverStrong"] },
  { title: "Text", keys: ["textPrimary", "textSecondary", "textMuted"] },
  { title: "Accent", keys: ["accent", "accentStrong", "accentSoft", "accentContrast"] },
  { title: "Process status", keys: ["stopped", "starting", "running", "stopping", "exited", "failed"] },
  { title: "Feedback", keys: ["warning", "danger", "info"] },
  { title: "Terminal", keys: ["terminalBackground", "terminalForeground", "terminalCursor", "terminalSelection"] }
];

const LABELS: Record<keyof MuxlyTheme, string> = {
  appBackground: "App background",
  surfaceBackground: "Panel surface",
  elevatedBackground: "Popover surface",
  border: "Borders and dividers",
  hoverSubtle: "Subtle hover",
  hoverStrong: "Strong hover",
  textPrimary: "Primary text",
  textSecondary: "Secondary text",
  textMuted: "Muted text",
  accent: "Accent",
  accentStrong: "Strong accent",
  accentSoft: "Soft accent",
  accentContrast: "Text on accent",
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  exited: "Exited",
  failed: "Failed",
  warning: "Warning",
  danger: "Danger",
  info: "Info",
  terminalBackground: "Terminal background",
  terminalForeground: "Terminal text",
  terminalCursor: "Terminal cursor",
  terminalSelection: "Terminal selection"
};

export function ThemeSettings({
  settings,
  onSave,
  onPreview
}: {
  settings: AppSettings;
  onSave: (next: AppSettings) => Promise<AppSettings>;
  onPreview: (theme: MuxlyTheme | null) => void;
}) {
  const original = useMemo(
    () => resolveTheme(settings.themePreset, settings.theme),
    [settings.theme, settings.themePreset]
  );
  const [preset, setPreset] = useState<ThemePresetId>(settings.themePreset ?? "default");
  const [draft, setDraft] = useState<MuxlyTheme>(original);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Invalid partial hex input must not reach the terminal palette.
    onPreview(resolveTheme("custom", { ...original, ...Object.fromEntries(
      Object.entries(draft).filter(([, value]) => /^#[0-9a-f]{6}$/i.test(value))
    ) }));
  }, [draft, original, onPreview]);

  useEffect(() => () => onPreview(null), [onPreview]);

  const lowContrast =
    contrastRatio(draft.textPrimary, draft.appBackground) < 4.5 ||
    contrastRatio(draft.textSecondary, draft.surfaceBackground) < 4.5 ||
    contrastRatio(draft.terminalForeground, draft.terminalBackground) < 4.5;

  const choosePreset = (value: string) => {
    if (saving) return;
    const next = value as ThemePresetId;
    setPreset(next);
    if (next !== "custom") setDraft(THEME_PRESETS[next]);
    setMessage(null);
  };

  const setColor = (key: keyof MuxlyTheme, value: string) => {
    if (saving) return;
    setPreset("custom");
    setDraft((current) => ({ ...current, [key]: value }));
    setMessage(null);
  };

  const save = async () => {
    if (saving) return;
    const invalid = Object.values(draft).some((value) => !/^#[0-9a-f]{6}$/i.test(value));
    if (invalid) {
      setMessage("Use six-digit hex colours such as #22d3ee.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const overrides = preset === "custom" ? draft : {};
      await onSave({ ...settings, themePreset: preset, theme: overrides });
      setMessage("Theme saved");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const resetAll = async () => {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      await onSave({ ...settings, themePreset: "default", theme: {} });
      setPreset("default");
      setDraft(DEFAULT_THEME);
      setMessage("Default theme restored and saved");
    } catch (error) {
      const detail = error && typeof error === "object" && "message" in error
        ? String(error.message)
        : String(error);
      setMessage(`Could not reset theme: ${detail}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4" aria-labelledby="appearance-heading">
      <div>
        <h3 id="appearance-heading" className="text-sm font-semibold text-zinc-100">Appearance</h3>
        <p className="mt-1 text-xs text-zinc-500">Preview presets and colour edits, then save to keep them. Reset and save defaults restores the default theme immediately.</p>
      </div>
      <fieldset disabled={saving} className="space-y-4">
      <Dropdown
        value={preset}
        ariaLabel="Theme preset"
        options={[
          { value: "default", label: "Muxly Default" },
          { value: "midnight", label: "Midnight" },
          { value: "high-contrast", label: "High Contrast" },
          { value: "custom", label: "Custom" }
        ]}
        onChange={choosePreset}
      />
      {GROUPS.map((group) => (
        <div key={group.title} className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h4 className="text-xs font-medium text-zinc-300">{group.title}</h4>
            <Button
              variant="link"
              size="xs"
              onClick={() => {
                setMessage(null);
                setPreset("custom");
                setDraft((current) => {
                  const next = { ...current };
                  for (const key of group.keys) next[key] = DEFAULT_THEME[key];
                  return next;
                });
              }}
            >
              Reset group
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {group.keys.map((key) => {
              const inputId = `theme-colour-${key}`;
              return (
              <div key={key} className="flex items-center gap-2 rounded-md bg-white/5 px-2 py-1.5 text-xs text-zinc-400">
                <ColorPicker color={draft[key]} label={LABELS[key]} onChange={(value) => setColor(key, value)} />
                <label htmlFor={inputId} className="min-w-0 flex-1 truncate">{LABELS[key]}</label>
                <input
                  id={inputId}
                  value={draft[key]}
                  onChange={(event) => setColor(key, event.target.value)}
                  aria-label={`${LABELS[key]} hex colour`}
                  className="w-20 rounded border border-white/10 bg-black/25 px-1.5 py-1 font-mono text-[11px] text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
                />
              </div>
              );
            })}
          </div>
        </div>
      ))}
      {lowContrast ? (
        <div role="alert" className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Some primary text pairs are below the WCAG 4.5:1 contrast target.{" "}
          <button type="button" className="font-medium underline" onClick={() => { setPreset("custom"); setDraft((current) => ({ ...current, textPrimary: "#ffffff", textSecondary: "#f4f4f5", terminalForeground: "#ffffff" })); }}>
            Apply accessible text
          </button>
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save theme"}</Button>
          <Button variant="secondary" size="sm" onClick={() => void resetAll()} disabled={saving}>Reset and save defaults</Button>
        </div>
        {message ? <span role="status" className="text-xs text-zinc-400">{message}</span> : null}
      </div>
      </fieldset>
    </section>
  );
}
