import { useMemo, useState } from "react";
import type { ServiceConfig } from "./types";
import { Button } from "./Button";
import { Field } from "./FormField";
import { ServiceIconInput } from "./ServiceIconInput";
import { looksLikeDevServer } from "./devServerHeuristics";
import { fromDraft, toDraft, validate } from "./serviceFormModel";
import type { ServiceFormDraft } from "./serviceFormModel";

// Matches the shortcut label used elsewhere â€” `âŒ˜` on macOS, `Ctrl` otherwise.
const modKey = navigator.userAgent.includes("Mac") ? "âŒ˜" : "Ctrl";


type Props = {
  initial: ServiceConfig | null; // null = new service
  existingIds: string[]; // for id-uniqueness validation (excluding the one being edited)
  onSave: (service: ServiceConfig) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>; // omit for new services
};

export function ServiceForm({ initial, existingIds, onSave, onCancel, onDelete }: Props) {
  const [draft, setDraft] = useState<ServiceFormDraft>(() => toDraft(initial));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validationError = useMemo(() => validate(draft, existingIds), [draft, existingIds]);

  // Heuristic nudge: when the command looks like a dev server / watcher but PTY
  // mode is still off, suggest turning it on (see `looksLikeDevServer`). Purely
  // a suggestion â€” without a TTY these tools tend to exit cleanly mid-HMR, and
  // that failure is invisible, so we flag it at creation time rather than
  // letting the user discover it later. The user can ignore it or just tick the
  // checkbox directly.
  const suggestPty = useMemo(
    () => !draft.usePty && looksLikeDevServer(draft.program, draft.argsText),
    [draft.usePty, draft.program, draft.argsText]
  );

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave(fromDraft(draft));
    } catch (caught) {
      setError(String(caught));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!onDelete) return;
    if (!confirm(`Delete service "${draft.name || draft.id}"?`)) return;

    setSaving(true);
    setError(null);
    try {
      await onDelete();
    } catch (caught) {
      setError(String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <h2 className="text-sm font-semibold">{initial ? "Edit service" : "New service"}</h2>
        <Button variant="link" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-sm">
        <Field label="ID" hint="Unique short identifier, e.g. web-api">
          <input
            value={draft.id}
            onChange={(e) => setDraft({ ...draft, id: e.target.value })}
            disabled={initial !== null}
            className="form-input"
            placeholder="web-api"
          />
        </Field>

        <Field label="Name">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="form-input"
            placeholder="Web API"
          />
        </Field>
        <ServiceIconInput
          iconType={draft.iconType}
          iconValue={draft.iconValue}
          onIconTypeChange={(iconType) => setDraft({ ...draft, iconType, iconValue: "" })}
          onIconValueChange={(iconValue) => setDraft({ ...draft, iconValue })}
        />

        <Field label="Program" hint="The executable, e.g. npm, node, python">
          <input
            value={draft.program}
            onChange={(e) => setDraft({ ...draft, program: e.target.value })}
            className="form-input"
            placeholder="npm"
          />
        </Field>

        <Field label="Arguments" hint="One per line">
          <textarea
            value={draft.argsText}
            onChange={(e) => setDraft({ ...draft, argsText: e.target.value })}
            rows={3}
            className="form-input font-mono text-xs"
            placeholder={"run\ndev"}
          />
        </Field>

        <Field label="Working dir" hint="Absolute or relative to services.json">
          <input
            value={draft.cwd}
            onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
            className="form-input font-mono text-xs"
            placeholder="."
          />
        </Field>

        <Field label="Environment" hint="KEY=value per line">
          <textarea
            value={draft.envText}
            onChange={(e) => setDraft({ ...draft, envText: e.target.value })}
            rows={3}
            className="form-input font-mono text-xs"
            placeholder={"NODE_ENV=development\nPORT=3000"}
          />
        </Field>

        <Field
          label="Pre-run"
          hint="Optional. Runs before the command in the same shell, so env changes carry over â€” e.g. nvm use 20, source .venv/bin/activate. Leave empty to spawn directly."
        >
          <input
            value={draft.preRun}
            onChange={(e) => setDraft({ ...draft, preRun: e.target.value })}
            className="form-input font-mono text-xs"
            placeholder="nvm use 20"
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Port" hint="Optional, for browser open">
            <input
              value={draft.port}
              onChange={(e) => setDraft({ ...draft, port: e.target.value })}
              type="number"
              inputMode="numeric"
              className="form-input"
              placeholder="3000"
            />
          </Field>

          <Field label="Group" hint="Optional sidebar grouping">
            <input
              value={draft.group}
              onChange={(e) => setDraft({ ...draft, group: e.target.value })}
              className="form-input"
              placeholder="frontend"
            />
          </Field>
        </div>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.autoRestart}
            onChange={(e) => setDraft({ ...draft, autoRestart: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">
              Auto-restart on crash
            </span>
            <span className="block text-[11px] text-zinc-500">
              Re-spawn automatically if the process exits with an error (max 3 tries per minute)
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.usePty}
            onChange={(e) => setDraft({ ...draft, usePty: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">
              Run in pseudo-terminal
            </span>
            <span className="block text-[11px] text-zinc-500">
              Enable for dev servers with hot reload (Vite, WXT, Next.js). Without a TTY they can exit mid-rebuild. Output may include raw ANSI colour codes.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            checked={draft.sensitive}
            onChange={(e) => setDraft({ ...draft, sensitive: e.target.checked })}
            className="mt-0.5"
          />
          <span>
            <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">
              Sensitive name
            </span>
            <span className="block text-[11px] text-zinc-500">
              Mask this service's name (sidebar, pane header, search) while Stream mode is on â€” toggle it from the command palette ({modKey}+P) before screen-sharing.
            </span>
          </span>
        </label>

        {suggestPty ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-100">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="mt-px size-3.5 shrink-0 text-amber-300"
              aria-hidden="true"
            >
              <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
            </svg>
            <span className="min-w-0 flex-1">
              This looks like a dev server or watch command. Turn on{" "}
              <span className="font-medium">Run in pseudo-terminal</span> so it
              survives hot-reloads â€” without a TTY these tools can exit cleanly
              mid-rebuild.
            </span>
            <button
              type="button"
              onClick={() => setDraft({ ...draft, usePty: true })}
              className="shrink-0 rounded border border-amber-400/50 bg-amber-500/20 px-2 py-1 font-medium text-amber-50 transition hover:bg-amber-500/30"
            >
              Enable
            </button>
          </div>
        ) : null}

        {error || validationError ? (
          <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            {error ?? validationError}
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-white/10 px-5 py-4">
        {onDelete ? (
          <Button variant="destructive" size="sm" onClick={handleDelete} disabled={saving}>
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={saving || validationError !== null}
          >
            {saving
              ? initial
                ? "Savingâ€¦"
                : "Addingâ€¦"
              : initial
              ? "Save changes"
              : "Add service"}
          </Button>
        </div>
      </div>
    </form>
  );
}


