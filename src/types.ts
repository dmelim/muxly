export type ServiceStatus =
  | "stopped"
  | "starting"
  | "restarting"
  | "running"
  | "stopping"
  | "exited"
  | "failed";

export type ServiceConfig = {
  id: string;
  name: string;
  icon?: ServiceIcon | null;
  program: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  port?: number | null;
  // When true, `port` is a *preferred* port: if it's busy at launch Muxly rolls
  // to the next free port and injects the chosen value into the process (env var
  // named by `portEnvVar`, default PORT, plus any `{port}` placeholders in args
  // and env values). When false, a busy port is a hard error. Default false.
  autoPort: boolean;
  // Env var name that receives the chosen port when `autoPort` is on. Empty =
  // PORT. Ignored when autoPort is off.
  portEnvVar?: string | null;
  group?: string | null;
  // Id of the profile this service belongs to (see AppSettings.profiles).
  // Absent/null = unassigned, which shows under every profile. A value that no
  // longer matches a known profile id is treated as unassigned.
  profile?: string | null;
  autoRestart: boolean;
  // Spawn the service attached to a pseudo-terminal instead of pipes. Needed
  // for dev servers (Vite, WXT) whose HMR loop depends on a real TTY; without
  // one they exit cleanly after the first rebuild. Off by default.
  usePty: boolean;
  // Optional shell prelude run before the command, in the same shell, so its
  // env changes carry over (e.g. "nvm use 20", "source .venv/bin/activate").
  // Empty/absent = spawn directly. See process::shell on the backend.
  preRun?: string | null;
  // When true, this service's identity is masked while Stream mode is on.
  // Terminal logs remain visible through the redacted Stream mode mirror.
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

export type RuntimeCandidate = {
  label: string;
  path: string;
};

export type RuntimeRequirementIssue = {
  runtime: string;
  executable: string;
  serviceIds: string[];
  serviceNames: string[];
  candidates: RuntimeCandidate[];
};

export type RuntimeRequirementReport = {
  issues: RuntimeRequirementIssue[];
  activeFallbackPaths: string[];
};

// A named profile. Profiles partition which services the sidebar shows: only
// services whose `profile` matches the active one (plus unassigned services)
// are visible. This list is the id→name registry; membership lives on each
// service's `profile` field.
export type Profile = {
  id: string;
  name: string;
};

// A saved editor added by the user. `command` is one executable path or
// command name; it is never parsed as a shell command line.
export type CustomEditor = {
  id: string;
  name: string;
  command: string;
};

// Editors found by the native discovery command. Detected entries are kept
// separate from custom settings so a scan can never overwrite a user's draft.
export type EditorCandidate = {
  id: string;
  label: string;
  command: string;
  path?: string | null;
};

export type WorkspacePanel = {
  id: string;
  tabIds: string[];
  activeTabId: string;
};

import type { MuxlyTheme, ThemePresetId } from "./theme";

export type AppSettings = {
  editorCommand: string;
  // Optional to keep settings.json written by older Muxly versions valid.
  customEditors?: CustomEditor[];
  // Manual per-project "hide name" toggle (the sidebar eye button). Hides the
  // project name regardless of stream mode.
  hiddenProjectNames: Record<string, boolean>;
  // Per-project collapsed (minimized) state in the sidebar. Persisted so a
  // project you minimize stays minimized across restarts. Absent = expanded.
  collapsedProjectNames: Record<string, boolean>;
  // Pinned projects are shown before unpinned projects in the sidebar.
  pinnedProjectNames?: Record<string, boolean>;
  // Projects flagged sensitive in the Settings list. Independent of the manual
  // toggle above — these are hidden only while stream mode is on.
  sensitiveProjectNames: Record<string, boolean>;
  projectNameAliases: Record<string, string>;
  // The user's managed profiles (id→name registry). Empty = feature unused.
  profiles: Profile[];
  // Id of the active profile, or null for "All profiles". Cleared by the
  // backend if it no longer names an existing profile.
  activeProfile: string | null;
  // Continuously persisted workspace state. Optional for backwards
  // compatibility with settings files written before pane restore existed.
  openPaneIds?: string[];
  focusedPaneId?: string | null;
  splitPaneIds?: string[];
  workspacePanels?: WorkspacePanel[];
  focusedPanelId?: string | null;
  openServicesInTabs?: boolean;
  themePreset?: ThemePresetId;
  theme?: Partial<MuxlyTheme>;
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
  runToken: number;
  stream: "stdout" | "stderr";
  chunk: string;
};

export type ProcessStartedEvent = {
  serviceId: string;
  pid: number;
  runToken: number;
  // The port the service actually bound to, if any. For an auto-port service
  // this is the rolled/chosen port, which may differ from the configured one.
  port?: number | null;
};

export type ProcessExitedEvent = {
  serviceId: string;
  runToken: number;
  code: number | null;
  /** Name of the signal that killed the process (`SIGKILL`, `SIGSEGV`), when it
   * died from one. Unix only; a signal death carries no exit code. */
  signal: string | null;
  requested: boolean;
};

export type ProcessFailedEvent = {
  serviceId: string;
  runToken: number;
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

// Keep masked names compact without retaining any characters from the private
// identity. Length is capped so a long name cannot distort tabs or cards.
const MAX_MASK_BULLETS = 8;

// Mask a sensitive service name without retaining a reversible suffix.
export function maskSensitiveName(name: string): string {
  return "•".repeat(Math.max(3, Math.min(name.length, MAX_MASK_BULLETS)));
}

// The name to display for a service given the current stream-mode state. Masks
// only services explicitly flagged `sensitive`; everything else is unchanged.
export function displayServiceName(service: ServiceConfig, streamMode: boolean): string {
  return streamMode && service.sensitive ? maskSensitiveName(service.name) : service.name;
}

type AbsolutePath = { base: string; segments: string[] };

// Split an absolute path into the root we keep (a drive like "C:", or "" for a
// POSIX root) and the directory segments below it. Returns null for relative
// paths — they carry no host/user-identifying prefix worth hiding.
function parseAbsolutePath(p: string): AbsolutePath | null {
  const drive = /^([A-Za-z]:)[\\/]+(.*)$/.exec(p);
  if (drive) {
    return { base: drive[1], segments: splitSegments(drive[2]) };
  }
  if (/^[\\/]/.test(p)) {
    return { base: "", segments: splitSegments(p) };
  }
  return null;
}

function splitSegments(rest: string): string[] {
  return rest.split(/[\\/]+/).filter(Boolean);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replacePrivateIdentity(text: string, identity: string, replacement: string): string {
  const name = identity.trim();
  if (!name) return text;
  if (name.length > 2) {
    return text.replace(new RegExp(escapeRegExp(name), "gi"), () => replacement);
  }
  const bounded = new RegExp(
    `(^|[^\\p{L}\\p{N}_])${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}_])`,
    "giu"
  );
  return text.replace(bounded, (_match, prefix) => `${prefix}${replacement}`);
}

function streamUrlLabel(raw: string): string {
  try {
    const url = new URL(raw);
    const local = url.hostname === "localhost"
      || url.hostname === "127.0.0.1"
      || url.hostname === "::1"
      || url.hostname === "[::1]";
    if (!local) return "[external URL]";
    const path = url.pathname !== "/" || url.search || url.hash ? "/[private path]" : "";
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return "[URL]";
  }
}

export function redactStreamText(text: string, streamMode: boolean): string {
  if (!streamMode) return text;
  return text
    .replace(/\b(?:https?|wss?):\/\/[^\s\x1b]+/gi, streamUrlLabel)
    .replace(/\bfile:\/\/[^\s\x1b]+/gi, "[private path]")
    .replace(/([A-Za-z]:[\\/]Users[\\/])[^\\/\r\n]+(?=[\\/])/gi, "$1[private]")
    .replace(/(\/(?:home|Users)\/)[^/\r\n]+(?=\/)/g, "$1[private]")
    .replace(/(["'])(?:[A-Za-z]:[\\/][^"'\r\n]+|\\\\[^"'\r\n]+|\/[^"'\r\n]+)\1/g, "$1[private path]$1")
    .replace(/\\\\[^\s\\/]+[\\/][^\s"'<>|]+/g, "[network path]")
    .replace(/[A-Za-z]:[\\/][^\s"'<>|\x1b]+/g, "[private path]")
    .replace(/(^|[\s=(])~[\\/][^\s"'<>|\x1b]+/gm, "$1[private path]")
    .replace(/(^|[\s=(:>$])\/(?!\/)[^\s"'<>|\x1b]+/gm, "$1[private path]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/(^|\n)[A-Z0-9._-]+@[A-Z0-9._-]+(?=[:\s])/gi, "$1[local identity]");
}

/** Apply every configured private identity before the generic Stream filter. */
export function redactStreamWorkspaceText(
  text: string,
  services: readonly ServiceConfig[],
  projectNameAliases: Record<string, string>,
  sensitiveProjectNames: Record<string, boolean>,
  streamMode: boolean
): string {
  if (!streamMode) return text;

  const replacements = new Map<string, string>();
  for (const [groupName, sensitive] of Object.entries(sensitiveProjectNames)) {
    if (sensitive) {
      replacements.set(groupName.toLowerCase(), projectNameAliases[groupName]?.trim() || "private-project");
    }
  }
  for (const service of services) {
    if (!service.sensitive) continue;
    const groupName = service.group?.trim() || "Ungrouped";
    const replacement = projectNameAliases[groupName]?.trim() || "private-service";
    replacements.set(service.name.toLowerCase(), replacement);
    if (service.group?.trim()) replacements.set(service.group.trim().toLowerCase(), replacement);
  }

  let out = text;
  const identities = [...replacements.entries()].sort((left, right) => right[0].length - left[0].length);
  for (const [identity, replacement] of identities) {
    out = replacePrivateIdentity(out, identity, replacement);
  }
  return redactStreamText(out, true);
}

// Stream mode is a display transform. Raw configuration, process data and log
// buffers remain untouched. Generic personal identifiers are removed from all
// services; configured group/service identities are additionally replaced
// when that service is marked sensitive.
export function redactSensitive(
  text: string,
  service: ServiceConfig,
  alias: string,
  streamMode: boolean
): string {
  if (!streamMode) return text;

  // Privacy must not depend on alias generation having completed. A missing
  // alias can happen briefly while settings/services are loading, and showing
  // the raw value during that gap would make Stream mode fail open.
  const safeAlias = service.sensitive
    ? alias.trim() || "private-project"
    : "private-path";

  const pairs: Array<{ needle: string; replacement: string }> = [];

  // The cwd plus every ancestor directory, in both separator styles (tools
  // print "\" or "/" interchangeably on Windows). Matching is case-insensitive
  // — drive letters and Windows paths are, and tools sometimes lowercase the
  // drive.
  const cwd = service.cwd?.trim();
  const parsed = cwd ? parseAbsolutePath(cwd) : null;
  if (parsed && parsed.segments.length > 0) {
    for (const sep of ["\\", "/"] as const) {
      const root = parsed.base + sep; // "C:\", "C:/", or "/"
      for (let depth = parsed.segments.length; depth >= 1; depth -= 1) {
        pairs.push({
          needle: parsed.base + sep + parsed.segments.slice(0, depth).join(sep),
          replacement: root + safeAlias
        });
      }
    }
  }

  // The real group and service names, deduped case-insensitively. Short names
  // use token boundaries so an identity such as "db" does not alter words.
  const seen = new Set<string>();
  for (const raw of service.sensitive ? [service.group, service.name] : []) {
    const name = raw?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (name.length <= 2) text = replacePrivateIdentity(text, name, safeAlias);
    else pairs.push({ needle: name, replacement: safeAlias });
  }

  // Longest needles first so a child path keeps its tail, a replaced prefix is
  // never re-matched by a shorter ancestor rule, and a name embedded in a path
  // is consumed by the path rule before the bare-name rule runs.
  pairs.sort((a, b) => b.needle.length - a.needle.length);

  let out = text;
  for (const { needle, replacement } of pairs) {
    out = out.replace(new RegExp(escapeRegExp(needle), "gi"), () => replacement);
  }

  return redactStreamText(out, true);
}
