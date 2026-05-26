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
