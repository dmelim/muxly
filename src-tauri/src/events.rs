use serde::Serialize;

pub const PROCESS_STARTED: &str = "process_started";
pub const PROCESS_EXITED: &str = "process_exited";
pub const PROCESS_FAILED: &str = "process_failed";

/// Emitted when a PTY session's child exits or its reader hits EOF.
pub const PTY_CLOSED: &str = "pty_closed";

/// Emitted when `services.json` changes on disk (external edit, e.g. by an
/// agent or the user's editor). The frontend reloads its service list.
pub const SERVICES_CHANGED: &str = "services_changed";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessStartedEvent {
    pub service_id: String,
    pub pid: u32,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessOutputEvent {
    pub service_id: String,
    pub stream: OutputStream,
    pub chunk: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessExitedEvent {
    pub service_id: String,
    pub code: Option<i32>,
    pub requested: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessFailedEvent {
    pub service_id: String,
    pub message: String,
}

/// Output chunk streamed from an interactive PTY session opened by the bottom
/// terminal drawer. Keyed by `pty_id` so the frontend can route to the right
/// xterm instance when multiple shells are open.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyOutputEvent {
    pub pty_id: String,
    pub chunk: String,
}

/// Sent once the PTY's child exits or its master reader hits EOF. The frontend
/// uses this to mark the terminal as closed and prompt the user to reopen.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PtyClosedEvent {
    pub pty_id: String,
}
