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
pub const DEFAULT_SHOW_TIMESTAMPS: bool = true;

/// A named profile. Profiles partition which services are shown in the sidebar:
/// only services whose `profile` matches the active profile (plus unassigned
/// ones) are visible. Membership lives on each `ServiceConfig.profile` as an id;
/// this list is just the id→name registry, edited from Settings.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspacePanel {
    pub id: String,
    #[serde(default)]
    pub tab_ids: Vec<String>,
    #[serde(default)]
    pub active_tab_id: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_editor_command_string")]
    pub editor_command: String,
    #[serde(default, skip_serializing)]
    pub hide_project_names: bool,
    #[serde(default)]
    pub hidden_project_names: BTreeMap<String, bool>,
    /// Per-project collapsed (minimized) state in the sidebar. Persisted so a
    /// minimized project stays minimized across restarts. Absent = expanded.
    #[serde(default)]
    pub collapsed_project_names: BTreeMap<String, bool>,
    /// Projects shown before unpinned projects in the sidebar. The map keeps
    /// project ordering preferences out of individual service configuration.
    #[serde(default)]
    pub pinned_project_names: BTreeMap<String, bool>,
    /// Projects flagged sensitive in the Settings list. Distinct from
    /// `hidden_project_names` (the manual sidebar toggle): these are hidden
    /// only while stream mode is on, never on their own.
    #[serde(default)]
    pub sensitive_project_names: BTreeMap<String, bool>,
    #[serde(default)]
    pub project_name_aliases: BTreeMap<String, String>,
    /// The user's managed profiles (id→name registry). Empty = feature unused.
    #[serde(default)]
    pub profiles: Vec<Profile>,
    /// Id of the currently selected profile, or `None`/absent for "All
    /// profiles". Cleared on load/save if it doesn't match an existing profile.
    #[serde(default)]
    pub active_profile: Option<String>,
    #[serde(default)]
    pub open_pane_ids: Vec<String>,
    #[serde(default)]
    pub focused_pane_id: Option<String>,
    #[serde(default)]
    pub split_pane_ids: Vec<String>,
    #[serde(default)]
    pub workspace_panels: Vec<WorkspacePanel>,
    #[serde(default)]
    pub focused_panel_id: Option<String>,
    #[serde(default = "default_open_services_in_tabs")]
    pub open_services_in_tabs: bool,
    #[serde(default = "default_theme_preset")]
    pub theme_preset: String,
    #[serde(default)]
    pub theme: BTreeMap<String, String>,
    #[serde(default = "default_auto_restart_max_attempts")]
    pub auto_restart_max_attempts: u32,
    #[serde(default = "default_auto_restart_window_ms")]
    pub auto_restart_window_ms: u64,
    #[serde(default = "default_max_log_chunks")]
    pub max_log_chunks: u32,
    #[serde(default = "default_pane_grid_columns")]
    pub pane_grid_columns: u32,
    #[serde(default = "default_show_timestamps")]
    pub show_timestamps: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            editor_command: default_editor_command().to_string(),
            hide_project_names: false,
            hidden_project_names: BTreeMap::new(),
            collapsed_project_names: BTreeMap::new(),
            pinned_project_names: BTreeMap::new(),
            sensitive_project_names: BTreeMap::new(),
            project_name_aliases: BTreeMap::new(),
            profiles: Vec::new(),
            active_profile: None,
            open_pane_ids: Vec::new(),
            focused_pane_id: None,
            split_pane_ids: Vec::new(),
            workspace_panels: Vec::new(),
            focused_panel_id: None,
            open_services_in_tabs: true,
            theme_preset: default_theme_preset(),
            theme: BTreeMap::new(),
            auto_restart_max_attempts: DEFAULT_AUTO_RESTART_MAX_ATTEMPTS,
            auto_restart_window_ms: DEFAULT_AUTO_RESTART_WINDOW_MS,
            max_log_chunks: DEFAULT_MAX_LOG_CHUNKS,
            pane_grid_columns: DEFAULT_PANE_GRID_COLUMNS,
            show_timestamps: DEFAULT_SHOW_TIMESTAMPS,
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

fn default_open_services_in_tabs() -> bool {
    true
}

fn default_show_timestamps() -> bool {
    DEFAULT_SHOW_TIMESTAMPS
}

fn default_theme_preset() -> String {
    "default".to_string()
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
    normalize_active_profile(&mut settings);
    normalize_theme(&mut settings);

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
    normalize_active_profile(&mut settings);
    normalize_theme(&mut settings);

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

/// Drop `active_profile` if it doesn't name an existing profile, so a deleted
/// or renamed-away profile can never leave the app stuck on a phantom filter.
fn normalize_active_profile(settings: &mut AppSettings) {
    if let Some(active) = &settings.active_profile {
        let exists = settings
            .profiles
            .iter()
            .any(|profile| &profile.id == active);
        if !exists {
            settings.active_profile = None;
        }
    }
}

fn normalize_theme(settings: &mut AppSettings) {
    if !matches!(
        settings.theme_preset.as_str(),
        "default" | "midnight" | "high-contrast" | "custom"
    ) {
        settings.theme_preset = default_theme_preset();
    }
    const KEYS: &[&str] = &[
        "appBackground",
        "surfaceBackground",
        "elevatedBackground",
        "border",
        "hoverSubtle",
        "hoverStrong",
        "textPrimary",
        "textSecondary",
        "textMuted",
        "accent",
        "accentStrong",
        "accentSoft",
        "accentContrast",
        "stopped",
        "starting",
        "running",
        "stopping",
        "exited",
        "failed",
        "warning",
        "danger",
        "info",
        "terminalBackground",
        "terminalForeground",
        "terminalCursor",
        "terminalSelection",
    ];
    settings.theme.retain(|key, value| {
        KEYS.contains(&key.as_str())
            && value.len() == 7
            && value.starts_with('#')
            && value[1..]
                .chars()
                .all(|character| character.is_ascii_hexdigit())
    });
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

#[cfg(test)]
mod tests {
    use super::{normalize_theme, AppSettings};

    #[test]
    fn older_settings_default_to_tabs_with_no_panel_state() {
        let settings: AppSettings = serde_json::from_str("{}").expect("settings should load");

        assert!(settings.open_services_in_tabs);
        assert!(settings.workspace_panels.is_empty());
        assert!(settings.focused_panel_id.is_none());
        assert!(settings.pinned_project_names.is_empty());
    }

    #[test]
    fn theme_normalization_keeps_supported_semantic_tokens() {
        let mut settings = AppSettings::default();
        settings.theme_preset = "custom".into();
        settings.theme.insert("border".into(), "#2A2D31".into());
        settings
            .theme
            .insert("hoverStrong".into(), "#25282d".into());
        settings.theme.insert("info".into(), "#38bdf8".into());

        normalize_theme(&mut settings);

        assert_eq!(settings.theme.len(), 3);
    }

    #[test]
    fn theme_normalization_drops_invalid_values_and_unknown_keys() {
        let mut settings = AppSettings::default();
        settings.theme_preset = "unknown".into();
        settings.theme.insert("accent".into(), "cyan".into());
        settings
            .theme
            .insert("componentButton".into(), "#ffffff".into());

        normalize_theme(&mut settings);

        assert_eq!(settings.theme_preset, "default");
        assert!(settings.theme.is_empty());
    }
}
