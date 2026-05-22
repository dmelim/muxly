//! Run-history persistence backed by SQLite (bundled, no system dependency).
//!
//! Every service start inserts a `runs` row; the matching exit updates it with
//! an end time and exit code. Recording is best-effort — history is a
//! convenience, never a reason to fail a start or stop.

use crate::error::AppError;
use parking_lot::Mutex;
use rusqlite::Connection;
use serde::Serialize;
use std::{
    fs,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

/// SQLite connection guarded for cross-thread use. Stored as Tauri state.
pub struct HistoryDb(Mutex<Connection>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceHistory {
    pub total_runs: i64,
    pub failed_runs: i64,
    /// Unix-millis timestamp of the most recent start, if any.
    pub last_started_at: Option<i64>,
    /// Unix-millis timestamp of the most recent failing exit, if any.
    pub last_failure_at: Option<i64>,
}

impl HistoryDb {
    /// Open (creating if needed) `history.db` in the app data directory and
    /// apply the schema.
    pub fn open(app: &AppHandle) -> Result<Self, AppError> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|source| AppError::PathResolve {
                action: "resolve app data directory",
                message: source.to_string(),
            })?;
        fs::create_dir_all(&dir).map_err(|source| AppError::IoPath {
            action: "create app data directory",
            path: dir.clone(),
            source,
        })?;

        let connection = Connection::open(dir.join("history.db"))
            .map_err(|error| AppError::Database(error.to_string()))?;
        connection
            .execute_batch(
                "CREATE TABLE IF NOT EXISTS runs (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    service_id  TEXT    NOT NULL,
                    started_at  INTEGER NOT NULL,
                    ended_at    INTEGER,
                    exit_code   INTEGER,
                    requested   INTEGER NOT NULL DEFAULT 0
                 );
                 CREATE INDEX IF NOT EXISTS idx_runs_service
                    ON runs (service_id, started_at);",
            )
            .map_err(|error| AppError::Database(error.to_string()))?;

        Ok(Self(Mutex::new(connection)))
    }

    /// Record the start of a run. Best-effort: failures are swallowed.
    pub fn record_start(&self, service_id: &str) {
        let connection = self.0.lock();
        let _ = connection.execute(
            "INSERT INTO runs (service_id, started_at) VALUES (?1, ?2)",
            rusqlite::params![service_id, now_millis()],
        );
    }

    /// Close out the open run for a service. Best-effort. The single-instance
    /// guarantee means at most one run per service has `ended_at IS NULL`.
    pub fn record_exit(&self, service_id: &str, exit_code: Option<i32>, requested: bool) {
        let connection = self.0.lock();
        let _ = connection.execute(
            "UPDATE runs SET ended_at = ?1, exit_code = ?2, requested = ?3
             WHERE service_id = ?4 AND ended_at IS NULL",
            rusqlite::params![now_millis(), exit_code, requested as i64, service_id],
        );
    }

    fn service_history(&self, service_id: &str) -> Result<ServiceHistory, AppError> {
        let connection = self.0.lock();
        let to_err = |error: rusqlite::Error| AppError::Database(error.to_string());

        let total_runs: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM runs WHERE service_id = ?1",
                [service_id],
                |row| row.get(0),
            )
            .map_err(to_err)?;
        let failed_runs: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM runs
                 WHERE service_id = ?1 AND exit_code IS NOT NULL AND exit_code <> 0",
                [service_id],
                |row| row.get(0),
            )
            .map_err(to_err)?;
        let last_started_at: Option<i64> = connection
            .query_row(
                "SELECT MAX(started_at) FROM runs WHERE service_id = ?1",
                [service_id],
                |row| row.get(0),
            )
            .map_err(to_err)?;
        let last_failure_at: Option<i64> = connection
            .query_row(
                "SELECT MAX(ended_at) FROM runs
                 WHERE service_id = ?1 AND exit_code IS NOT NULL AND exit_code <> 0",
                [service_id],
                |row| row.get(0),
            )
            .map_err(to_err)?;

        Ok(ServiceHistory {
            total_runs,
            failed_runs,
            last_started_at,
            last_failure_at,
        })
    }
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn get_service_history(
    db: tauri::State<'_, HistoryDb>,
    service_id: String,
) -> Result<ServiceHistory, AppError> {
    db.service_history(&service_id)
}
