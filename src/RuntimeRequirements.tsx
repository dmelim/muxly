import { useEffect, useState } from "react";
import { Button } from "./Button";
import { errorMessage } from "./appUtils";
import { AlertTriangleIcon, CloseIcon } from "./icons";
import type { RuntimeRequirementReport } from "./types";

type Props = {
  report: RuntimeRequirementReport;
  onActivate: (path: string) => Promise<void>;
  onRecheck: () => Promise<void>;
  onClose: () => void;
};

export function RuntimeRequirements({ report, onActivate, onRecheck, onClose }: Props) {
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const activate = async (path: string) => {
    setBusyPath(path);
    setError(null);
    try {
      await onActivate(path);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyPath(null);
    }
  };

  const recheck = async () => {
    setRechecking(true);
    setError(null);
    try {
      await onRecheck();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setRechecking(false);
    }
  };

  const affectedCount = new Set(report.issues.flatMap((issue) => issue.serviceIds)).size;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-20"
      onClick={onClose}
    >
      <div
        className="flex max-h-[calc(100vh-10rem)] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-white/10 bg-[#15181d] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Missing runtime requirements"
      >
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="flex min-w-0 gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-amber-500/15 text-amber-300">
              <AlertTriangleIcon className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-zinc-100">Runtime requirements missing</h2>
              <p className="mt-1 text-xs leading-5 text-zinc-400">
                {affectedCount} {affectedCount === 1 ? "service needs" : "services need"} a
                runtime or executable that Muxly cannot currently resolve.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close runtime warning">
            <CloseIcon className="size-4" />
          </Button>
        </header>

        <div className="min-h-0 overflow-y-auto p-5">
          <div className="space-y-3">
            {report.issues.map((issue) => (
              <section
                key={`${issue.runtime}:${issue.executable}`}
                className="rounded-md border border-white/10 bg-white/[0.025] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-medium text-zinc-200">{issue.runtime}</h3>
                      <code className="rounded bg-black/25 px-1.5 py-0.5 text-[11px] text-zinc-400">
                        {issue.executable}
                      </code>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-zinc-500">
                      Required by {issue.serviceNames.join(", ")}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-medium text-amber-300">
                    Not found
                  </span>
                </div>

                {issue.candidates.length > 0 ? (
                  <div className="mt-3 border-t border-white/10 pt-3">
                    <p className="mb-2 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                      Discovered fallbacks
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {issue.candidates.map((candidate) => (
                        <Button
                          key={candidate.path}
                          variant="warning"
                          size="xs"
                          disabled={busyPath !== null || rechecking}
                          onClick={() => void activate(candidate.path)}
                        >
                          {busyPath === candidate.path ? "Activating…" : `Use ${candidate.label}`}
                        </Button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 border-t border-white/10 pt-3 text-xs text-zinc-500">
                    No safe fallback installation was discovered. Repair PATH or edit the affected
                    service command, then recheck.
                  </p>
                )}
              </section>
            ))}
          </div>

          {report.activeFallbackPaths.length > 0 ? (
            <div className="mt-4 rounded-md border border-cyan-400/15 bg-cyan-400/5 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-300">Session fallbacks active</p>
              {report.activeFallbackPaths.map((path) => (
                <code key={path} className="mt-1 block break-all text-[11px] text-zinc-400">
                  {path}
                </code>
              ))}
            </div>
          ) : null}

          {error ? (
            <p className="mt-4 rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-3">
          <p className="text-[11px] text-zinc-500">Fallbacks affect this Muxly session only.</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Dismiss
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busyPath !== null || rechecking}
              onClick={() => void recheck()}
            >
              {rechecking ? "Checking…" : "Recheck"}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
