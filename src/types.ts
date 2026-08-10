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

export type AppSettings = {
  editorCommand: string;
  // Manual per-project "hide name" toggle (the sidebar eye button). Hides the
  // project name regardless of stream mode.
  hiddenProjectNames: Record<string, boolean>;
  // Per-project collapsed (minimized) state in the sidebar. Persisted so a
  // project you minimize stays minimized across restarts. Absent = expanded.
  collapsedProjectNames: Record<string, boolean>;
  // Projects flagged sensitive in the Settings list. Independent of the manual
  // toggle above — these are hidden only while stream mode is on.
  sensitiveProjectNames: Record<string, boolean>;
  projectNameAliases: Record<string, string>;
  // The user's managed profiles (id→name registry). Empty = feature unused.
  profiles: Profile[];
  // Id of the active profile, or null for "All profiles". Cleared by the
  // backend if it no longer names an existing profile.
  activeProfile: string | null;
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

// Names short enough that aliasing them risks matching unrelated substrings in
// log output (e.g. a 2-letter project name inside ordinary words) are left
// alone — the path redaction still covers their directory.
const MIN_REDACTED_NAME = 3;

// Hide the host/user-identifying parts of text emitted by a sensitive service:
//   • filesystem paths under its working directory collapse to the project
//     alias, keeping only the drive/root (`C:\work\diethos\app` →
//     `C:\alpha-tango-sierra-42\app`). Every path segment can identify the
//     user, so the whole body between root and alias is hidden while a child
//     path keeps its generic tail.
//   • the project (group) and service names are replaced by the same alias, so
//     a leak like `> diethos@0.1.0 dev` becomes `> alpha-tango-sierra-42@0.1.0`.
// localhost, URLs, ports, and relative paths are never matched — they neither
// start with the cwd nor equal a name.
//
// Applied at display time only (raw logs stay verbatim), mirroring how
// `displayServiceName` masks names. Gated on stream mode and the `sensitive`
// flag so it's a no-op in the common case.
export function redactSensitive(
  text: string,
  service: ServiceConfig,
  alias: string,
  streamMode: boolean
): string {
  if (!streamMode || !service.sensitive || !alias) return text;

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
          replacement: root + alias
        });
      }
    }
  }

  // The real group and service names, deduped case-insensitively.
  const seen = new Set<string>();
  for (const raw of [service.group, service.name]) {
    const name = raw?.trim();
    if (!name || name.length < MIN_REDACTED_NAME) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ needle: name, replacement: alias });
  }

  // Longest needles first so a child path keeps its tail, a replaced prefix is
  // never re-matched by a shorter ancestor rule, and a name embedded in a path
  // is consumed by the path rule before the bare-name rule runs.
  pairs.sort((a, b) => b.needle.length - a.needle.length);

  let out = text;
  for (const { needle, replacement } of pairs) {
    out = out.replace(new RegExp(escapeRegExp(needle), "gi"), () => replacement);
  }
  return out;
}
