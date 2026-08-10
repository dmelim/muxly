import type { ServiceConfig } from "./types";

export type EditTarget =
  | { mode: "edit"; service: ServiceConfig }
  | { mode: "new" }
  | { mode: "import" };

// Surfaced health of an in-progress PTY start that hasn't produced output yet.
// - `waiting-port`: the service has a port; we're not killing it, just waiting
//   for that port to come up (the reliable "started" signal). Informational.
// - `retrying`: a portless service produced no output; the ConPTY deadlock
//   watchdog is recycling it (Windows only — the only recovery signal we have
//   without a port).
// - `stuck`: a portless service produced nothing after every retry and needs
//   user attention.
// - `quiet`: a portless service produced no output and we are NOT going to do
//   anything about it. Off Windows there is no deadlock to recover from, so
//   silence is just silence — reported, never acted on.
export type StartHealth =
  | { kind: "waiting-port"; port: number | null }
  | { kind: "retrying"; attempt: number; max: number }
  | { kind: "stuck"; max: number }
  | { kind: "quiet" };
