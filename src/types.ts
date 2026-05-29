export type ServiceStatus = "stopped" | "starting" | "running" | "stopping" | "exited" | "failed";

export type ServiceConfig = {
  id: string;
  name: string;
  icon?: ServiceIcon | null;
  program: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  port?: number | null;
  group?: string | null;
  autoRestart: boolean;
  // Spawn the service attached to a pseudo-terminal instead of pipes. Needed
  // for dev servers (Vite, WXT) whose HMR loop depends on a real TTY; without
  // one they exit cleanly after the first rebuild. Off by default.
  usePty: boolean;
};

export type ServiceIcon =
  | { type: "emoji"; value: string }
  | { type: "builtin"; value: string }
  | { type: "image"; path: string };

// Result of `load_services`: the entries that loaded cleanly, plus a
// human-readable note for every entry that was skipped (malformed JSON,
// failed validation, or a duplicate id). The loader is resilient — a single
// bad entry no longer empties the list.
export type LoadedServices = {
  services: ServiceConfig[];
  problems: string[];
};

export type AppSettings = {
  editorCommand: string;
  hiddenProjectNames: Record<string, boolean>;
  projectNameAliases: Record<string, string>;
  // Auto-restart guardrails — when a service crashes (status: failed), we
  // re-spawn up to `autoRestartMaxAttempts` times within `autoRestartWindowMs`.
  // A quiet period exceeding the window resets the budget.
  autoRestartMaxAttempts: number;
  autoRestartWindowMs: number;
  // Max number of log chunks (output writes) kept in memory per service.
  maxLogChunks: number;
  // Max columns shown in the terminal-pane grid before wrapping to a new row.
  paneGridColumns: number;
  // Prepend a dim [HH:MM:SS] marker to the start of every line of service
  // output. Cosmetic only — does not change what is stored in the log
  // buffer beyond the inserted marker.
  showTimestamps: boolean;
};

export type ProcessOutputEvent = {
  serviceId: string;
  stream: "stdout" | "stderr";
  chunk: string;
};

export type ProcessStartedEvent = {
  serviceId: string;
  pid: number;
};

export type ProcessExitedEvent = {
  serviceId: string;
  code: number | null;
  requested: boolean;
};

export type ProcessFailedEvent = {
  serviceId: string;
  message: string;
};

export type ServiceHistory = {
  totalRuns: number;
  failedRuns: number;
  lastStartedAt: number | null;
  lastFailureAt: number | null;
};

export function formatCommand(service: ServiceConfig) {
  return [service.program, ...service.args].join(" ");
}
