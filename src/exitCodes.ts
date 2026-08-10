// Human-friendly decoding of process exit codes.
//
// The Tauri backend forwards the OS-level exit code unchanged. On Windows
// that means abnormal terminations are NTSTATUS values, which arrive as
// large negative i32s (e.g. -1073741502 = 0xC0000142 STATUS_DLL_INIT_FAILED).
// On Unix-likes, exit codes are 0..255 — but when a process is killed by a
// signal, the Rust backend already maps that to `code = None` (rendered
// as "signal"), so this module focuses on the numeric case.
//
// `describeExitCode(code)` returns a short string suitable for both the
// terminal banner and the Details inspector. It always *starts* with the
// raw code so existing log scraping/muscle memory still works, and adds
// the hex form + a known-status hint when we recognise it.

type ExitHint = {
  /** Symbolic NTSTATUS / well-known status name. */
  name: string;
  /** One-sentence plain-English hint about likely causes. */
  description: string;
};

// Subset of NTSTATUS values that actually show up in dev tooling — the full
// table is enormous and most entries are irrelevant for app processes.
// Keys are the 32-bit unsigned hex form (uppercase, no leading 0x) so
// `i32 → u32 → toString(16)` lookups stay simple.
const WINDOWS_STATUS_HINTS: Record<string, ExitHint> = {
  C0000005: {
    name: "STATUS_ACCESS_VIOLATION",
    description:
      "the process dereferenced an invalid pointer — typically a native crash inside an addon or the runtime itself"
  },
  C000001D: {
    name: "STATUS_ILLEGAL_INSTRUCTION",
    description:
      "the CPU hit an instruction it can't execute — often a binary built for a different CPU feature set than this machine has"
  },
  C0000094: {
    name: "STATUS_INTEGER_DIVIDE_BY_ZERO",
    description: "the process divided by zero in native code"
  },
  C00000FD: {
    name: "STATUS_STACK_OVERFLOW",
    description: "the process exhausted its stack — usually infinite recursion"
  },
  C000013A: {
    name: "STATUS_CONTROL_C_EXIT",
    description: "the process was terminated via Ctrl+C / console interrupt"
  },
  C0000135: {
    name: "STATUS_DLL_NOT_FOUND",
    description:
      "a required DLL is missing on this machine — check that runtime redistributables (e.g. Visual C++) and native module .dll/.node files are installed and on PATH"
  },
  C0000139: {
    name: "STATUS_ENTRYPOINT_NOT_FOUND",
    description:
      "a DLL was loaded but is missing an expected export — usually a version mismatch between the binary and one of its dependencies"
  },
  C0000142: {
    name: "STATUS_DLL_INIT_FAILED",
    description:
      "a DLL failed to initialise during process startup — common causes on Windows: a 32/64-bit architecture mismatch, a corrupt native module, antivirus quarantining the file, or a missing Visual C++ runtime"
  },
  C000014C: {
    name: "STATUS_REGISTRY_CORRUPT",
    description: "the registry hive the process tried to read is corrupt"
  },
  C0000374: {
    name: "STATUS_HEAP_CORRUPTION",
    description:
      "the heap was corrupted — almost always a bug in native code (use-after-free, double-free, buffer overrun)"
  },
  C0000409: {
    name: "STATUS_STACK_BUFFER_OVERRUN",
    description:
      "a stack buffer was overrun and the OS killed the process via /GS — a native security check fired"
  },
  C000041D: {
    name: "STATUS_UNHANDLED_EXCEPTION",
    description:
      "the process died from an unhandled C++/SEH exception in native code"
  },
  C00000FE: {
    name: "STATUS_NO_USER_SESSION_KEY",
    description: "no user session key was available — usually a permissions/SSO setup issue"
  }
};

// Plain-English hints for the signals a supervised dev process realistically
// dies from. Signals the user caused (SIGTERM/SIGINT/SIGHUP) need no
// explanation; the ones worth annotating are the crashes and the kills a user
// did not ask for, where the signal name alone doesn't say what went wrong.
const SIGNAL_HINTS: Record<string, string> = {
  SIGKILL:
    "force-killed — something outside the process ended it; on a dev box this is usually the macOS/Linux OOM killer or a manual kill -9",
  SIGSEGV:
    "segmentation fault — a native crash, typically inside a native addon or the runtime itself",
  SIGBUS: "bus error — a misaligned or invalid memory access in native code",
  SIGABRT:
    "aborted — the runtime called abort(), usually after a failed assertion or an unhandled C++ exception",
  SIGFPE: "arithmetic error in native code, such as an integer divide by zero",
  SIGILL:
    "illegal instruction — often a binary built for a different CPU than this machine has (an x86-only native module on Apple Silicon, say)",
  SIGXCPU: "exceeded its CPU time limit",
  SIGXFSZ: "exceeded the maximum file size limit"
};

/**
 * Format a process exit code for display. Returns strings like:
 *   "code 0"
 *   "code 1"
 *   "code -1073741502 (0xC0000142, STATUS_DLL_INIT_FAILED — …)"
 *   "SIGSEGV — segmentation fault — a native crash, …"   // signal death
 *   "signal"           // signal death we couldn't name
 *   "stopped by user"  // when requested is true
 */
export function describeExitCode(
  code: number | null,
  requested: boolean,
  signal: string | null = null
): string {
  if (requested) return "stopped by user";
  if (signal) {
    const hint = SIGNAL_HINTS[signal];
    return hint ? `${signal} — ${hint}` : signal;
  }
  if (code === null) return "signal";

  // Positive exit codes on every OS are just program-defined statuses. We
  // surface the raw number — interpretation is up to the user / the
  // program's own docs. Only large negative values get the decode pass,
  // which is where Windows hides NTSTATUS.
  if (code >= 0) return `code ${code}`;

  // Convert the i32 back to its u32 NTSTATUS form for hex display + lookup.
  const unsigned = (code >>> 0) >>> 0;
  const hex = unsigned.toString(16).toUpperCase().padStart(8, "0");
  const hint = WINDOWS_STATUS_HINTS[hex];
  if (!hint) {
    return `code ${code} (0x${hex})`;
  }
  return `code ${code} (0x${hex}, ${hint.name} — ${hint.description})`;
}

/** Compact form for the Details inspector's "Last Exit" row — no prose. */
export function shortExitCode(
  code: number | null,
  requested: boolean,
  signal: string | null = null
): string {
  if (requested) return "stopped";
  if (signal) return signal;
  if (code === null) return "signal";
  if (code >= 0) return String(code);
  const unsigned = (code >>> 0) >>> 0;
  const hex = unsigned.toString(16).toUpperCase().padStart(8, "0");
  const hint = WINDOWS_STATUS_HINTS[hex];
  return hint ? `${code} (${hint.name})` : `${code} (0x${hex})`;
}
