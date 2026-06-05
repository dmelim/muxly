import { useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { ServiceConfig } from "./types";
import { Button } from "./Button";

type ImportCandidate = {
  source: string;
  suggestedId: string;
  name: string;
  program: string;
  args: string[];
  cwd: string;
  recommended: boolean;
};

type Row = ImportCandidate & { selected: boolean; id: string };

type Props = {
  existingIds: string[];
  onImport: (services: ServiceConfig[]) => Promise<void>;
  onCancel: () => void;
};

const ID_PATTERN = /^[a-zA-Z0-9._-]+$/;

export function ImportPanel({ existingIds, onImport, onCancel }: Props) {
  const [dir, setDir] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-row id validation: non-empty, valid characters, and unique against
  // both existing services and the other rows selected for import.
  const idErrors = useMemo(() => {
    const seen = new Map<string, number>();
    for (const row of rows) {
      if (!row.selected) continue;
      const id = row.id.trim();
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    return rows.map((row) => {
      if (!row.selected) return null;
      const id = row.id.trim();
      if (!id) return "ID required";
      if (!ID_PATTERN.test(id)) return "Invalid characters";
      if (existingIds.includes(id)) return "Already used by another service";
      if ((seen.get(id) ?? 0) > 1) return "Duplicate in this import";
      return null;
    });
  }, [rows, existingIds]);

  const selectedCount = rows.filter((row) => row.selected).length;
  const hasErrors = idErrors.some((err) => err !== null);
  const canImport = selectedCount > 0 && !hasErrors && !importing;

  async function chooseFolder() {
    setError(null);
    let picked: string | null;
    try {
      const result = await open({
        directory: true,
        multiple: false,
        title: "Choose a project folder to import from"
      });
      picked = typeof result === "string" ? result : null;
    } catch (caught) {
      setError(messageOf(caught));
      return;
    }
    if (!picked) return;

    setScanning(true);
    setError(null);
    try {
      const candidates = await invoke<ImportCandidate[]>("scan_importable", { dir: picked });
      setDir(picked);
      // Pre-select the recommended (long-running) entries. If nothing is
      // recommended, fall back to selecting everything so the panel is usable.
      const anyRecommended = candidates.some((c) => c.recommended);
      setRows(
        candidates.map((c) => ({
          ...c,
          selected: anyRecommended ? c.recommended : true,
          id: c.suggestedId
        }))
      );
      if (candidates.length === 0) {
        setError("No package.json scripts or Procfile entries found in that folder.");
      }
    } catch (caught) {
      setError(messageOf(caught));
      setRows([]);
    } finally {
      setScanning(false);
    }
  }

  function patchRow(index: number, patch: Partial<Row>) {
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row))
    );
  }

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      const group = folderName(dir);
      const services: ServiceConfig[] = rows
        .filter((row) => row.selected)
        .map((row) => ({
          id: row.id.trim(),
          name: row.name,
          icon: null,
          program: row.program,
          args: row.args,
          cwd: row.cwd,
          env: {},
          port: null,
          autoPort: false,
          portEnvVar: null,
          group,
          autoRestart: false,
          usePty: false,
          preRun: null,
          sensitive: false
        }));
      await onImport(services);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <h2 className="text-sm font-semibold">Import services</h2>
        <Button variant="link" onClick={onCancel}>
          Cancel
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5 text-sm">
        <div>
          <Button
            variant="dashed"
            size="sm"
            onClick={chooseFolder}
            disabled={scanning}
            className="w-full"
          >
            {scanning ? "Scanning…" : dir ? "Choose a different folder…" : "Choose project folder…"}
          </Button>
          {dir ? (
            <p className="mt-1.5 break-all font-mono text-[11px] text-zinc-500">{dir}</p>
          ) : (
            <p className="mt-1.5 text-[11px] text-zinc-500">
              Scans for npm/pnpm/yarn scripts and Procfile entries.
            </p>
          )}
        </div>

        {rows.length > 0 ? (
          <ul className="space-y-2">
            {rows.map((row, index) => (
              <li
                key={`${row.source}-${row.suggestedId}-${index}`}
                className="rounded-md border border-white/10 bg-black/20 p-3"
              >
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(e) => patchRow(index, { selected: e.target.checked })}
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-zinc-100">
                        {row.name}
                      </span>
                      <span className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-zinc-400">
                        {row.source}
                      </span>
                      {row.recommended ? (
                        <span className="shrink-0 rounded bg-cyan-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-cyan-300">
                          suggested
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[11px] text-zinc-500">
                      {[row.program, ...row.args].join(" ")}
                    </span>
                  </span>
                </label>

                {row.selected ? (
                  <div className="mt-2 pl-6">
                    <input
                      value={row.id}
                      onChange={(e) => patchRow(index, { id: e.target.value })}
                      className="form-input"
                      placeholder="service-id"
                      aria-label="Service ID"
                    />
                    {idErrors[index] ? (
                      <p className="mt-1 text-[11px] text-rose-300">{idErrors[index]}</p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}

        {error ? (
          <p className="rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>
        ) : null}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={importing}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleImport} disabled={!canImport}>
          {importing
            ? "Importing…"
            : selectedCount > 0
            ? `Import ${selectedCount} service${selectedCount === 1 ? "" : "s"}`
            : "Import"}
        </Button>
      </div>
    </div>
  );
}

// The last path segment of the scanned folder, used as the sidebar group so
// services imported from one project cluster together.
function folderName(dir: string | null): string | null {
  if (!dir) return null;
  const segments = dir.split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : null;
}

function messageOf(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
