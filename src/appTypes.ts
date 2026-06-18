import type { ServiceConfig } from "./types";

export type EditTarget =
  | { mode: "edit"; service: ServiceConfig }
  | { mode: "new" }
  | { mode: "import" };

// Surfaced health of an in-progress PTY start that hasn't produced output yet.
// - `waiting-port`: the service has a port; we're not killing it, just waiting
//   for that port to come up (the reliable "started" signal). Informational.
// - `retrying`: a portless service produced no output; the deadlock watchdog is
//   recycling it (the only recovery signal we have without a port).
// - `stuck`: a portless service produced nothing after every retry — likely a
//   genuine ConPTY deadlock; left running for the user to restart.
export type StartHealth =
  | { kind: "waiting-port"; port: number | null }
  | { kind: "retrying"; attempt: number; max: number }
  | { kind: "stuck"; max: number };
