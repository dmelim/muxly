import { useMemo, useState } from "react";
import type { ServiceConfig } from "./types";
import { Button } from "./Button";

export type ServiceFormDraft = {
  id: string;
  name: string;
  program: string;
  argsText: string; // one arg per line
  cwd: string;
  envText: string; // KEY=value per line
  port: string; // string for input control
  group: string;
  autoRestart: boolean;
};

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
                ? "Saving…"
                : "Adding…"
              : initial
              ? "Save changes"
              : "Add service"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium uppercase tracking-wider text-zinc-400">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-zinc-500">{hint}</span> : null}
    </label>
  );
}

function toDraft(service: ServiceConfig | null): ServiceFormDraft {
  if (!service) {
    return {
      id: "",
      name: "",
      program: "",
      argsText: "",
      cwd: ".",
      envText: "",
      port: "",
      group: "",
      autoRestart: false
    };
  }
  return {
    id: service.id,
    name: service.name,
    program: service.program,
    argsText: service.args.join("\n"),
    cwd: service.cwd,
    envText: Object.entries(service.env)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    port: service.port != null ? String(service.port) : "",
    group: service.group ?? "",
    autoRestart: service.autoRestart
  };
}

function fromDraft(draft: ServiceFormDraft): ServiceConfig {
  const args = draft.argsText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const env: Record<string, string> = {};
  for (const rawLine of draft.envText.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue; // skip malformed lines silently — validate() flagged them
    env[line.slice(0, eq).trim()] = line.slice(eq + 1);
  }

  const portValue = draft.port.trim();
  const port = portValue ? Number(portValue) : null;

  const groupValue = draft.group.trim();

  return {
    id: draft.id.trim(),
    name: draft.name.trim(),
    program: draft.program.trim(),
    args,
    cwd: draft.cwd.trim() || ".",
    env,
    port: Number.isFinite(port) ? port : null,
    group: groupValue || null,
    autoRestart: draft.autoRestart
  };
}

function validate(draft: ServiceFormDraft, existingIds: string[]): string | null {
  const id = draft.id.trim();
  if (!id) return "ID is required";
  if (existingIds.includes(id)) return `ID "${id}" is already used by another service`;
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) return "ID may only contain letters, numbers, dot, dash, underscore";

  if (!draft.name.trim()) return "Name is required";
  if (!draft.program.trim()) return "Program is required";
  if (!draft.cwd.trim()) return "Working dir is required";

  if (draft.port.trim()) {
    const port = Number(draft.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return "Port must be an integer between 1 and 65535";
    }
  }

  for (const rawLine of draft.envText.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) return `Env line "${line}" must be KEY=value`;
  }

  return null;
}
