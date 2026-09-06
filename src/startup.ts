import type { MuxlyTheme } from "./theme";

// Shared across scans, so overlapping refreshes cannot exceed the limit.
export function createTaskQueue(limit: number) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Invalid concurrency limit");
  let active = 0;
  const waiting: Array<() => void> = [];
  return async function run<T>(work: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
    else active += 1;
    try { return await work(); }
    finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}
export const runPortCheck = createTaskQueue(4);
export const runRuntimeCheck = createTaskQueue(1);

export function startupMark(phase: string, duration?: number) {
  performance.mark(`muxly:${phase}`);
  console.debug(`[startup] ${phase}: ${Math.round(duration ?? performance.now())} ms ${duration == null ? "since navigation" : "elapsed"}`);
}

// Saved settings are authoritative. This small mirror only colours the first
// frame, before IPC is available; unsaved appearance previews never reach it.
export function mirrorBootTheme(theme: MuxlyTheme) {
  try {
    const colours = {
      background: theme.appBackground, foreground: theme.textPrimary,
      muted: theme.textMuted, accent: theme.accent, border: theme.border
    };
    for (const [key, value] of Object.entries(colours)) {
      document.documentElement.style.setProperty(`--boot-${key}`, value);
    }
    localStorage.setItem("muxly.boot-theme", JSON.stringify(colours));
  } catch { /* Storage may be disabled; the inline splash has safe defaults. */ }
}
