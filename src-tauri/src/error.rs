use serde::Serialize;
use std::{io, path::PathBuf};
use thiserror::Error;

/// Errors returned to the frontend. Serialised as `{ code, message }` so the UI
/// can branch on stable codes without parsing free-form text.
#[derive(Debug, Error)]
pub enum AppError {
    #[error("Failed to {action}: {source}")]
    Io {
        action: &'static str,
        #[source]
        source: io::Error,
    },

    #[error("Failed to {action} {}: {source}", path.display())]
    IoPath {
        action: &'static str,
        path: PathBuf,
        #[source]
        source: io::Error,
    },

    #[error("Failed to {action}: {message}")]
    PathResolve {
        action: &'static str,
        message: String,
    },

    #[error("Failed to parse {}: {source}", path.display())]
    ConfigParse {
        path: PathBuf,
        #[source]
        source: serde_json::Error,
    },

    #[error("Invalid service config {}: {}", path.display(), problems.join("; "))]
    ConfigInvalid {
        path: PathBuf,
        problems: Vec<String>,
    },

    #[error("{0}")]
    ConfigUnavailable(String),

    #[error("{service_name} is already running")]
    AlreadyRunning { service_name: String },

    #[error("{service_id} is not running")]
    NotRunning { service_id: String },

    #[error("Failed to start {program} in {}: {source}", cwd.display())]
    ProcessStart {
        program: String,
        cwd: PathBuf,
        #[source]
        source: io::Error,
    },

    #[error("{0}")]
    ProcessStop(String),

    #[error("Port {port} is already in use (cannot start {service_name})")]
    PortInUse { service_name: String, port: u16 },

    #[error("No free port found for {service_name} in {tried} ports starting at {base}")]
    NoFreePort {
        service_name: String,
        base: u16,
        tried: u16,
    },

    #[error("History database error: {0}")]
    Database(String),
}

impl AppError {
    fn code(&self) -> &'static str {
        match self {
            Self::Io { .. } | Self::IoPath { .. } => "io_error",
            Self::PathResolve { .. } => "path_resolve_error",
            Self::ConfigParse { .. } => "config_parse_error",
            Self::ConfigInvalid { .. } => "config_invalid",
            Self::ConfigUnavailable(_) => "config_unavailable",
            Self::AlreadyRunning { .. } => "already_running",
            Self::NotRunning { .. } => "not_running",
            Self::ProcessStart { .. } => "process_start_failed",
            Self::ProcessStop(_) => "process_stop_failed",
            Self::PortInUse { .. } => "port_in_use",
            Self::NoFreePort { .. } => "no_free_port",
            Self::Database(_) => "database_error",
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ErrorPayload {
    code: &'static str,
    message: String,
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        ErrorPayload {
            code: self.code(),
            message: self.to_string(),
        }
        .serialize(serializer)
    }
}
