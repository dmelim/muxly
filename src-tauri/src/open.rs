//! Cross-platform "open in…" helpers.
//!
//! These commands shell out to the OS's native launchers. We deliberately use
//! a *blocking* spawn pattern: each launcher exits immediately after handing
//! the request off to the target app, so there is no long-running child to
//! manage. We do not capture stdout/stderr.

use crate::{
    error::AppError,
    services::{config::resolve_cwd, config::ServicesConfigDir},
    settings::default_editor_command,
};
use std::{
    path::{Path, PathBuf},
    process::Command,
};
use tauri::State;

/// Open the given path in the user's editor of choice.
#[tauri::command]
pub fn open_in_editor(
    config_dir: State<'_, ServicesConfigDir>,
    cwd: String,
    editor_command: Option<String>,
) -> Result<(), AppError> {
    let path = resolve(&cwd, &config_dir)?;
    let program = editor_command
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(default_editor_command());

    Command::new(program)
        .arg(&path)
        .spawn()
        .map(|_| ())
        .map_err(|source| AppError::ProcessStart {
            program: program.to_string(),
            cwd: path,
            source,
        })
}

/// Open the given path in the platform file manager.
#[tauri::command]
pub fn open_in_file_manager(
    config_dir: State<'_, ServicesConfigDir>,
    cwd: String,
) -> Result<(), AppError> {
    let path = resolve(&cwd, &config_dir)?;

    let (program, args) = file_manager_command(&path);
    Command::new(program)
        .args(&args)
        .spawn()
        .map(|_| ())
        .map_err(|source| AppError::ProcessStart {
            program: program.to_string(),
            cwd: path,
            source,
        })
}

/// Open a URL in the default browser.
#[tauri::command]
pub fn open_url(url: String) -> Result<(), AppError> {
    let (program, args) = url_opener_command(&url);
    Command::new(program)
        .args(&args)
        .spawn()
        .map(|_| ())
        .map_err(|source| AppError::ProcessStart {
            program: program.to_string(),
            cwd: PathBuf::from("."),
            source,
        })
}

fn resolve(cwd: &str, config_dir: &ServicesConfigDir) -> Result<PathBuf, AppError> {
    resolve_cwd(cwd, config_dir.current().as_deref())
}

#[cfg(windows)]
fn file_manager_command(path: &Path) -> (&'static str, Vec<String>) {
    // `explorer.exe` opens the folder; passing a file would highlight it via
    // `/select,`, but for now we treat the cwd as a directory.
    ("explorer.exe", vec![path.display().to_string()])
}

#[cfg(target_os = "macos")]
fn file_manager_command(path: &Path) -> (&'static str, Vec<String>) {
    ("open", vec![path.display().to_string()])
}

#[cfg(all(unix, not(target_os = "macos")))]
fn file_manager_command(path: &Path) -> (&'static str, Vec<String>) {
    ("xdg-open", vec![path.display().to_string()])
}

#[cfg(windows)]
fn url_opener_command(url: &str) -> (&'static str, Vec<String>) {
    // `cmd /C start "" "url"` is the most reliable way to hand a URL to the
    // default browser on Windows. The empty `""` is the window title argument
    // that `start` requires when the first quoted token would otherwise be
    // taken as the title.
    (
        "cmd",
        vec!["/C".to_string(), "start".to_string(), "".to_string(), url.to_string()],
    )
}

#[cfg(target_os = "macos")]
fn url_opener_command(url: &str) -> (&'static str, Vec<String>) {
    ("open", vec![url.to_string()])
}

#[cfg(all(unix, not(target_os = "macos")))]
fn url_opener_command(url: &str) -> (&'static str, Vec<String>) {
    ("xdg-open", vec![url.to_string()])
}
