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
  // Optional shell prelude run before the command, in the same shell, so its
  // env changes carry over (e.g. "nvm use 20", "source .venv/bin/activate").
  // Empty/absent = spawn directly. See process::shell on the backend.
  preRun?: string | null;
  // When true, this service's name is masked while "stream mode" is on (a
  // Command-palette toggle) so the window is safe to screen-share.
  sensitive?: boolean;
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
  // Manual per-project "hide name" toggle (the sidebar eye button). Hides the
  // project name regardless of stream mode.
  hiddenProjectNames: Record<string, boolean>;
  // Projects flagged sensitive in the Settings list. Independent of the manual
  // toggle above — these are hidden only while stream mode is on.
  sensitiveProjectNames: Record<string, boolean>;
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

// How many trailing characters of a sensitive name stay visible while masked,
// and the cap on how many bullets stand in for the hidden portion (so a very
// long name doesn't produce an unwieldy run of dots).
const VISIBLE_SUFFIX = 3;
const MAX_MASK_BULLETS = 8;

// Mask a sensitive service name, keeping only its last few characters so panes
// and cards stay distinguishable while the bulk of the name is hidden. Names
// short enough that the suffix would reveal everything are fully bulleted.
export function maskSensitiveName(name: string): string {
  if (name.length <= VISIBLE_SUFFIX) {
    return "•".repeat(Math.max(name.length, 1));
  }
  const hidden = Math.min(name.length - VISIBLE_SUFFIX, MAX_MASK_BULLETS);
  return "•".repeat(hidden) + name.slice(-VISIBLE_SUFFIX);
}

// The name to display for a service given the current stream-mode state. Masks
// only services explicitly flagged `sensitive`; everything else is unchanged.
export function displayServiceName(service: ServiceConfig, streamMode: boolean): string {
  return streamMode && service.sensitive ? maskSensitiveName(service.name) : service.name;
}
