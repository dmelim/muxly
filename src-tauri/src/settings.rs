use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, fs, path::PathBuf};
use tauri::{AppHandle, Manager};

// Defaults match the constants previously hard-coded in App.tsx so existing
// settings files (which won't have these keys) keep behaving identically.
pub const DEFAULT_AUTO_RESTART_MAX_ATTEMPTS: u32 = 3;
pub const DEFAULT_AUTO_RESTART_WINDOW_MS: u64 = 60_000;
pub const DEFAULT_MAX_LOG_CHUNKS: u32 = 5_000;
pub const DEFAULT_PANE_GRID_COLUMNS: u32 = 5;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_editor_command_string")]
    pub editor_command: String,
    #[serde(default, skip_serializing)]
    pub hide_project_names: bool,
    #[serde(default)]
    pub hidden_project_names: BTreeMap<String, bool>,
    #[serde(default)]
    pub project_name_aliases: BTreeMap<String, String>,
    #[serde(default = "default_auto_restart_max_attempts")]
    pub auto_restart_max_attempts: u32,
    #[serde(default = "default_auto_restart_window_ms")]
    pub auto_restart_window_ms: u64,
    #[serde(default = "default_max_log_chunks")]
    pub max_log_chunks: u32,
    #[serde(default = "default_pane_grid_columns")]
    pub pane_grid_columns: u32,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            editor_command: default_editor_command().to_string(),
            hide_project_names: false,
            hidden_project_names: BTreeMap::new(),
            project_name_aliases: BTreeMap::new(),
            auto_restart_max_attempts: DEFAULT_AUTO_RESTART_MAX_ATTEMPTS,
            auto_restart_window_ms: DEFAULT_AUTO_RESTART_WINDOW_MS,
            max_log_chunks: DEFAULT_MAX_LOG_CHUNKS,
            pane_grid_columns: DEFAULT_PANE_GRID_COLUMNS,
        }
    }
}

fn default_auto_restart_max_attempts() -> u32 {
    DEFAULT_AUTO_RESTART_MAX_ATTEMPTS
}

fn default_auto_restart_window_ms() -> u64 {
    DEFAULT_AUTO_RESTART_WINDOW_MS
}

fn default_max_log_chunks() -> u32 {
    DEFAULT_MAX_LOG_CHUNKS
}

fn default_pane_grid_columns() -> u32 {
    DEFAULT_PANE_GRID_COLUMNS
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<AppSettings, AppError> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let text = fs::read_to_string(&path).map_err(|source| AppError::IoPath {
        action: "read",
        path: path.clone(),
        source,
    })?;

    let mut settings: AppSettings =
        serde_json::from_str(&text).map_err(|source| AppError::ConfigParse {
            path: path.clone(),
            source,
        })?;

    if settings.editor_command.trim().is_empty() {
        settings.editor_command = default_editor_command().to_string();
    }
    settings.auto_restart_max_attempts = settings.auto_restart_max_attempts.min(20);
    settings.auto_restart_window_ms = settings.auto_restart_window_ms.clamp(1_000, 3_600_000);
    settings.max_log_chunks = settings.max_log_chunks.clamp(100, 100_000);
    settings.pane_grid_columns = settings.pane_grid_columns.clamp(1, 10);
    migrate_global_project_privacy(&mut settings);

    Ok(settings)
}

#[tauri::command]
pub fn save_settings(app: AppHandle, mut settings: AppSettings) -> Result<AppSettings, AppError> {
    migrate_global_project_privacy(&mut settings);
    if settings.editor_command.trim().is_empty() {
        settings.editor_command = default_editor_command().to_string();
    } else {
        settings.editor_command = settings.editor_command.trim().to_string();
    }
    // Clamp the numeric knobs to sensible bounds — saves us from a
    // typo'd "0 ms window" bricking auto-restart or a runaway log buffer
    // eating memory.
    settings.auto_restart_max_attempts = settings.auto_restart_max_attempts.min(20);
    settings.auto_restart_window_ms = settings.auto_restart_window_ms.clamp(1_000, 3_600_000);
    settings.max_log_chunks = settings.max_log_chunks.clamp(100, 100_000);
    settings.pane_grid_columns = settings.pane_grid_columns.clamp(1, 10);

    let path = settings_path(&app)?;
    let parent = path.parent().ok_or_else(|| {
        AppError::ConfigUnavailable("Could not resolve settings directory".into())
    })?;
    fs::create_dir_all(parent).map_err(|source| AppError::IoPath {
        action: "create settings directory",
        path: parent.to_path_buf(),
        source,
    })?;

    let text = serde_json::to_string_pretty(&settings).map_err(|source| AppError::ConfigParse {
        path: path.clone(),
        source,
    })?;
    fs::write(&path, text).map_err(|source| AppError::IoPath {
        action: "write",
        path,
        source,
    })?;

    Ok(settings)
}

pub fn default_editor_command() -> &'static str {
    if cfg!(windows) {
        "code.cmd"
    } else {
        "code"
    }
}

fn default_editor_command_string() -> String {
    default_editor_command().to_string()
}

fn migrate_global_project_privacy(settings: &mut AppSettings) {
    if !settings.hide_project_names {
        return;
    }

    for project_name in settings.project_name_aliases.keys() {
        settings
            .hidden_project_names
            .entry(project_name.clone())
            .or_insert(true);
    }
    settings.hide_project_names = false;
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, AppError> {
    let app_config_dir = app
        .path()
        .app_config_dir()
        .map_err(|source| AppError::PathResolve {
            action: "resolve app config directory",
            message: source.to_string(),
        })?;
    Ok(app_config_dir.join("settings.json"))
}
