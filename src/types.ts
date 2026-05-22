export type ServiceStatus = "stopped" | "starting" | "running" | "stopping" | "exited" | "failed";

export type ServiceConfig = {
  id: string;
  name: string;
  program: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  port?: number | null;
  group?: string | null;
  autoRestart: boolean;
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
