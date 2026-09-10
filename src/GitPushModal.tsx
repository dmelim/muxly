import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "./Button";
import { Dropdown } from "./Dropdown";
import { CloseIcon } from "./icons";

type Snapshot = {
  state: { root: string; branch: string; ahead: number; behind: number };
  changes: { path: string; status: string; staged: boolean }[];
  remotes: string[];
  token: string;
  blocked: string | null;
};
type Outcome = { committed: boolean; pushed: boolean; error: string | null };
type Props = { cwd: string; onClose: () => void; onComplete: () => void };

function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return String(error);
}

export function GitPushModal({ cwd, onClose, onComplete }: Props) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [remote, setRemote] = useState("");
  const [scope, setScope] = useState("staged");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const running = useRef(false);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement as HTMLElement | null;
    const appRoot = document.getElementById("root");
    const wasInert = appRoot?.inert ?? false;
    if (appRoot) appRoot.inert = true;
    dialogRef.current?.focus();
    return () => {
      alive.current = false;
      if (appRoot) appRoot.inert = wasInert;
      previous?.focus();
    };
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const next = await invoke<Snapshot>("git_action_snapshot", { cwd });
      if (!alive.current) return;
      setSnapshot(next);
      setRemote((current) => next.remotes.includes(current) ? current : next.remotes.includes("origin") ? "origin" : next.remotes[0] ?? "");
    } catch (caught) {
      if (alive.current) {
        setSnapshot(null);
        setError(errorMessage(caught));
      }
    } finally {
      if (alive.current) setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [cwd]);

  const execute = async (kind: "commit" | "push" | "commit-push") => {
    if (!snapshot || running.current || loading) return;
    running.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const outcome = await invoke<Outcome>("git_run_action", {
        cwd,
        action: {
          expectedRoot: snapshot.state.root,
          expectedToken: snapshot.token,
          kind, message, stageAll: scope === "all", remote
        }
      });
      if (!alive.current) return;
      if (outcome.committed) setMessage("");
      setResult(outcome.committed && outcome.pushed ? "Committed and pushed successfully." : outcome.committed ? "Commit saved locally." : outcome.pushed ? "Pushed successfully." : null);
      setError(outcome.error);
    } catch (caught) {
      if (alive.current) setError(errorMessage(caught));
    } finally {
      if (alive.current) {
        await load();
        onComplete();
        setBusy(false);
      }
      running.current = false;
    }
  };

  const unavailable = busy || loading || !snapshot || !!snapshot.blocked;
  const canCommit = !unavailable && !!message.trim() && !!snapshot?.changes.some((change) => scope === "all" || change.staged);
  const canPush = !unavailable && !!remote;

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-5" onClick={() => { if (!running.current) onClose(); }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="git-push-title"
        aria-busy={busy || loading}
        tabIndex={-1}
        className="flex max-h-[calc(100vh-40px)] w-full max-w-xl flex-col overflow-hidden rounded-lg border border-white/10 bg-[#15181d] text-zinc-100 shadow-2xl outline-none"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if ((event.target as Element).closest('[role="listbox"]')) {
            if (event.key === "Tab") {
              event.preventDefault();
              dialogRef.current?.focus();
            }
            return;
          }
          if (event.key === "Escape") {
            event.stopPropagation();
            if (!running.current) onClose();
          }
          if (event.key === "Tab") {
            const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []);
            const first = controls[0];
            const last = controls[controls.length - 1];
            if (!first) { event.preventDefault(); return; }
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
              event.preventDefault(); last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
              event.preventDefault(); first.focus();
            }
          }
        }}
      >
        <header className="flex items-start justify-between gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <h2 id="git-push-title" className="text-sm font-semibold">Commit & push</h2>
            <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">{snapshot?.state.root ?? "Loading repository…"}</p>
          </div>
          <Button variant="ghost" size="icon" className="shrink-0" aria-label="Close commit and push dialog" onClick={onClose} disabled={busy}>
            <CloseIcon className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 space-y-4 overflow-y-auto p-5">
          {snapshot ? <>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-md bg-cyan-400/10 px-2 py-1 font-mono text-cyan-300">{snapshot.state.branch}</span>
              <span className="text-zinc-400">{snapshot.state.ahead} ahead · {snapshot.state.behind} behind</span>
              <span className="text-[11px] text-zinc-500">Last fetched state</span>
            </div>
            <section className="overflow-hidden rounded-md border border-white/10">
              <div className="flex items-center justify-between gap-3 bg-white/5 px-3 py-2">
                <h3 className="text-xs font-medium">Changes <span className="text-zinc-500">({snapshot.changes.length})</span></h3>
                <Button variant="ghost" size="xs" disabled={busy || loading} onClick={() => { setError(null); void load(); }}>Refresh</Button>
              </div>
              <ul className="max-h-40 overflow-y-auto divide-y divide-white/10">
                {snapshot.changes.map((change, index) => <li key={`${index}:${change.path}`} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span className="w-5 shrink-0 whitespace-pre font-mono text-amber-300">{change.status}</span>
                  <span className="min-w-0 flex-1 break-all font-mono text-zinc-300">{change.path}</span>
                  <span className="shrink-0 text-[10px] text-zinc-500">{change.staged ? "Staged" : change.status === "??" ? "Untracked" : "Unstaged"}</span>
                </li>)}
              </ul>
              {!snapshot.changes.length ? <p className="px-3 py-3 text-xs text-zinc-500">Working tree clean. You can push existing commits.</p> : null}
            </section>
            <fieldset disabled={busy || loading} className="space-y-4 disabled:opacity-60">
              <div>
                <label htmlFor="git-commit-message" className="mb-1.5 block text-xs text-zinc-400">Commit message</label>
                <textarea id="git-commit-message" className="form-input min-h-20" maxLength={10000} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe your changes" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="min-w-0 space-y-1.5">
                  <p className="text-xs text-zinc-400">Include in commit</p>
                  <Dropdown ariaLabel="Include in commit" value={scope} onChange={setScope} options={[{ value: "staged", label: "Staged changes" }, { value: "all", label: "All changes" }]} />
                </div>
                <div className="min-w-0 space-y-1.5">
                  <p className="text-xs text-zinc-400">Push to remote</p>
                  <Dropdown ariaLabel="Push to remote" value={remote} onChange={setRemote} placeholder="No remote configured" options={snapshot.remotes.map((value) => ({ value, label: value }))} />
                </div>
              </div>
            </fieldset>
            <p className="text-[11px] text-zinc-500">{scope === "all" ? "All changes stages modified, deleted, and untracked files across this repository. " : "Only staged changes are included in a commit. "}{remote ? `Push sends committed changes to ${remote}/${snapshot.state.branch} and sets it as the upstream branch.` : "Add a remote in your editor or terminal to enable pushing."}</p>
            {snapshot.blocked ? <p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-300">{snapshot.blocked}</p> : null}
          </> : loading ? <p className="text-xs text-zinc-400">Loading changes…</p> : <Button onClick={() => { setError(null); void load(); }}>Retry</Button>}
          {result ? <p role="status" className="rounded-md bg-cyan-400/10 px-3 py-2 text-xs text-cyan-300">{result}</p> : null}
          {error ? <p role="alert" className="whitespace-pre-wrap break-words rounded-md bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p> : null}
        </div>
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-white/10 px-5 py-3">
          {busy ? <span role="status" className="mr-auto text-xs text-cyan-300">Running Git…</span> : null}
          <Button disabled={!canCommit} onClick={() => void execute("commit")}>Commit</Button>
          <Button disabled={!canPush} onClick={() => void execute("push")}>Push</Button>
          <Button variant="primary" disabled={!canCommit || !canPush} onClick={() => void execute("commit-push")}>Commit & push</Button>
        </footer>
      </div>
    </div>, document.body
  );
}
