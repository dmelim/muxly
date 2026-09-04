import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ServiceConfig } from "./types";
import { Button } from "./Button";
import { Dropdown } from "./Dropdown";
import { RefreshIcon } from "./icons";
import { Tooltip } from "./Tooltip";

type GitState = {
  root: string;
  branch: string;
  detached: boolean;
  dirty: boolean;
  ahead: number;
  behind: number;
};

type GitOverview = {
  state: GitState | null;
  branches: string[];
};

export function GitSection({ service, privateMode }: { service: ServiceConfig; privateMode: boolean }) {
  const [state, setState] = useState<GitState | null | undefined>(undefined);
  const [branches, setBranches] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const requestIdRef = useRef(0);
  const refreshRequestRef = useRef<{
    cwd: string;
    requestId: number;
    promise: Promise<void>;
  } | null>(null);
  const currentCwdRef = useRef(service.cwd);
  currentCwdRef.current = service.cwd;

  const refresh = useCallback((force = false) => {
    const cwd = service.cwd;
    if (currentCwdRef.current !== cwd) return Promise.resolve();
    const activeRequest = refreshRequestRef.current;
    if (
      !force &&
      activeRequest?.cwd === cwd &&
      activeRequest.requestId === requestIdRef.current
    ) {
      return activeRequest.promise;
    }

    const requestId = ++requestIdRef.current;
    setRefreshing(true);
    const promise = invoke<GitOverview>("git_overview", { cwd })
      .then((overview) => {
        if (requestIdRef.current !== requestId || currentCwdRef.current !== cwd) return;
        setState(overview.state);
        setBranches(overview.branches);
        setMessage(null);
      })
      .catch((error) => {
        if (requestIdRef.current !== requestId || currentCwdRef.current !== cwd) return;
        setState(null);
        setBranches([]);
        setMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (refreshRequestRef.current?.promise === promise) refreshRequestRef.current = null;
        if (requestIdRef.current === requestId && currentCwdRef.current === cwd) {
          setRefreshing(false);
        }
      });
    refreshRequestRef.current = { cwd, requestId, promise };
    return promise;
  }, [service.cwd]);

  useEffect(() => {
    requestIdRef.current += 1;
    setState(undefined);
    setBranches([]);
    setMessage(null);
    setBusy(false);
    setRefreshing(false);
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      requestIdRef.current += 1;
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  const displayMessage = message && (privateMode
    ? "Git operation failed. Turn off Stream mode to view repository details."
    : message);

  if (state === undefined) return <p className="text-xs text-zinc-500">Checking repository…</p>;
  if (state === null) return <p className="text-xs text-zinc-500">Not a Git repository{displayMessage ? `: ${displayMessage}` : "."}</p>;

  const branchLabel = privateMode ? "Private branch" : state.branch;
  const rootLabel = privateMode ? "Private repository" : state.root;
  const refreshButton = (
    <Tooltip label={refreshing ? "Refreshing repository" : "Refresh repository"} side="top">
      <Button
        variant="secondary"
        size="icon"
        onClick={() => void refresh()}
        disabled={busy || refreshing}
        aria-label={refreshing ? "Refreshing repository" : "Refresh repository"}
        aria-busy={refreshing}
      >
        <RefreshIcon className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
      </Button>
    </Tooltip>
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono text-zinc-200">{branchLabel}</span>
        {state.dirty ? <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">Modified</span> : <span className="text-zinc-500">Clean</span>}
        {state.ahead > 0 ? <span className="text-cyan-300">↑{state.ahead}</span> : null}
        {state.behind > 0 ? <span className="text-amber-300">↓{state.behind}</span> : null}
      </div>
      <p className="truncate font-mono text-[11px] text-zinc-500" title={privateMode ? undefined : state.root}>{rootLabel}</p>
      <div className="flex items-center gap-2">
        {refreshButton}
        {!privateMode && !state.detached && branches.length > 0 ? (
          <Dropdown
            className="min-w-0 flex-1"
            ariaLabel="Switch local Git branch"
            value={state.branch}
            options={branches.map((branch) => ({ value: branch, label: branch }))}
            onChange={(branch) => {
              if (branch === state.branch) return;
              setBusy(true);
              setMessage(null);
              void invoke<GitState>("git_switch_branch", {
                cwd: service.cwd,
                branch,
                expectedRoot: state.root
              })
                // A focus/manual refresh may still be resolving from before
                // the checkout. Force a new request so that stale snapshot can
                // neither be reused nor overwrite the switched branch state.
                .then(() => refresh(true))
                .catch((error) => setMessage(error instanceof Error ? error.message : String(error)))
                .finally(() => setBusy(false));
            }}
          />
        ) : privateMode && !state.detached && branches.length > 0 ? (
          <p className="text-[11px] text-zinc-500">
            Branch switching is unavailable while Stream mode hides branch names.
          </p>
        ) : null}
      </div>
      {displayMessage ? <p role="status" className="text-right text-[11px] text-amber-300">{displayMessage}</p> : null}
    </div>
  );
}
