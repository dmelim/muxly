import type { AppSettings, ServiceConfig, ServiceStatus } from "./types";
import { aliasProjectName } from "./privacyNames";

export const AUTO_RESTART_DELAY_MS = 1_000;

// Last-resort watchdog for portless PTY services, where output is the only
// readiness signal. The Windows cursor-inheritance handshake is handled
// deterministically in the Rust output pump; this bounded recycle remains for
// unrelated launchers that can fail silently before producing real output.
//
// Recycling is Windows-only (see `isWindows`). It exists to break a ConPTY
// startup deadlock, and Unix ptys have no equivalent failure mode — there,
// killing a service purely for being quiet for 8s would be destroying a
// perfectly healthy watcher or worker on no evidence at all.
export const PTY_WATCHDOG_MS = 8_000;
export const PTY_RECYCLE_MAX = 4;

// Platform sniffing from the webview's user agent — the same signal `modKey`
// uses. Good enough for choosing between platform workarounds, and it avoids a
// round trip to the backend before the first render.
export const isWindows = navigator.userAgent.includes("Windows");

// Shorthand shown in shortcut tooltips. macOS uses Cmd, everything else Ctrl.
export const modKey = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl";

export const statusLabels: Record<ServiceStatus, string> = {
  stopped: "Stopped",
  starting: "Starting",
  running: "Running",
  stopping: "Stopping",
  exited: "Exited",
  failed: "Failed"
};

export const DEFAULT_SETTINGS: AppSettings = {
  editorCommand: "code",
  hiddenProjectNames: {},
  collapsedProjectNames: {},
  sensitiveProjectNames: {},
  projectNameAliases: {},
  profiles: [],
  activeProfile: null,
  autoRestartMaxAttempts: 3,
  autoRestartWindowMs: 60_000,
  maxLogChunks: 5_000,
  paneGridColumns: 5,
  showTimestamps: true
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function annotateChunkWithTimestamps(
  serviceId: string,
  chunk: string,
  lineState: Record<string, boolean>
): string {
  if (lineState[serviceId] === undefined) {
    lineState[serviceId] = true;
  }

  let out = "";
  for (let i = 0; i < chunk.length; i++) {
    const ch = chunk[i];
    if (lineState[serviceId] && ch !== "\n" && ch !== "\r") {
      out += formatTimestamp();
      lineState[serviceId] = false;
    }
    out += ch;
    if (ch === "\n") {
      lineState[serviceId] = true;
    }
  }
  return out;
}

export function groupKey(service: ServiceConfig) {
  return service.group?.trim() || "Ungrouped";
}

// Whether a service is visible under the given active profile. "All profiles"
// (null) shows everything; otherwise a service shows when it belongs to the
// active profile OR is unassigned (unassigned services act as globals and show
// under every profile).
export function isServiceInProfile(
  service: ServiceConfig,
  activeProfile: string | null
): boolean {
  if (!activeProfile) return true;
  const profile = service.profile?.trim();
  return !profile || profile === activeProfile;
}

// Services visible under the active profile, preserving order. Returns the
// input untouched for "All profiles" so the common case allocates nothing.
export function visibleForProfile(
  services: ServiceConfig[],
  activeProfile: string | null
): ServiceConfig[] {
  if (!activeProfile) return services;
  return services.filter((service) => isServiceInProfile(service, activeProfile));
}

export function groupServices(services: ServiceConfig[]): Array<[string, ServiceConfig[]]> {
  const order: string[] = [];
  const byGroup = new Map<string, ServiceConfig[]>();

  for (const service of services) {
    const key = groupKey(service);
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
      order.push(key);
    }
    byGroup.get(key)!.push(service);
  }

  return order.map((name) => [name, byGroup.get(name)!]);
}

export function ensureProjectAliases(groupNames: string[], settings: AppSettings) {
  let aliases = settings.projectNameAliases;

  for (const groupName of groupNames) {
    if (aliases[groupName]) continue;
    if (aliases === settings.projectNameAliases) {
      aliases = { ...settings.projectNameAliases };
    }
    aliases[groupName] = aliasProjectName(groupName, {
      ...settings,
      projectNameAliases: aliases
    });
  }

  return aliases;
}

export function sameServiceOrder(left: ServiceConfig[], right: ServiceConfig[]) {
  if (left.length !== right.length) return false;
  return left.every(
    (service, i) =>
      service.id === right[i].id && (service.group ?? null) === (right[i].group ?? null)
  );
}

export function sameAliases(left: Record<string, string>, right: Record<string, string>) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([key, value]) => right[key] === value);
}

export function timeAgo(timestamp: number | null): string {
  if (timestamp == null) {
    return "Never";
  }
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function errorMessage(error: unknown) {
  if (isBackendError(error)) {
    return error.message;
  }

  return String(error);
}

function formatTimestamp(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `\x1b[38;5;245m[${hh}:${mm}:${ss}]\x1b[0m `;
}

function isBackendError(error: unknown): error is { code: string; message: string } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "message" in error &&
    typeof (error as { code: unknown }).code === "string" &&
    typeof (error as { message: unknown }).message === "string"
  );
}
