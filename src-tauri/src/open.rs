//! Cross-platform "open in…" helpers.
//!
//! These commands shell out to the OS's native launchers. We deliberately use
//! a *blocking* spawn pattern: each launcher exits immediately after handing
//! the request off to the target app, so there is no long-running child to
//! manage. We do not capture stdout/stderr.

use crate::{
    error::AppError,
    runtime::{resolve_from_fallbacks, search_paths},
    services::{config::resolve_cwd, config::ServicesConfigDir},
    settings::default_editor_command,
};
use std::{
    ffi::OsString,
    io,
    path::{Path, PathBuf},
    process::Command,
};
use tauri::{AppHandle, State};

/// Open the given path in the user's editor of choice.
#[tauri::command(async)]
pub fn open_in_editor(
    app: AppHandle,
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

    // `code` and friends are shims installed into the *shell's* PATH, which a
    // GUI-launched app doesn't inherit. Prefer the detected installation, then
    // the login shell's PATH, before falling back to a bare name.
    let resolved = crate::editor::resolve_known_editor(&app, program)
        .or_else(|| resolve_from_fallbacks(program, &search_paths(&app)))
        .unwrap_or_else(|| PathBuf::from(OsString::from(program)));

    launch_editor(&resolved, &path)
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

fn launch_editor(editor: &Path, target: &Path) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        let mut command = Command::new(editor);
        if is_shell_shim(editor) {
            // Let Rust perform Windows argument quoting for the batch shim;
            // hand-built `cmd /C` strings can reinterpret metacharacters in a
            // user path. CREATE_NO_WINDOW suppresses only the shim console,
            // leaving the target GUI editor visible.
            command.creation_flags(0x0800_0000);
        }
        return command.arg(target).spawn().map(|_| ());
    }

    #[cfg(not(windows))]
    {
        #[cfg(target_os = "macos")]
        if is_app_bundle(editor) {
            return Command::new("open")
                .args(["-a"])
                .arg(editor)
                .arg(target)
                .spawn()
                .map(|_| ());
        }

        Command::new(editor).arg(target).spawn().map(|_| ())
    }
}

#[cfg(windows)]
fn is_shell_shim(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|extension| extension.to_str()),
        Some(extension)
            if extension.eq_ignore_ascii_case("cmd") || extension.eq_ignore_ascii_case("bat")
    )
}

#[cfg(target_os = "macos")]
fn is_app_bundle(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
        && path.is_dir()
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
