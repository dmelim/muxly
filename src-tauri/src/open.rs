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
///
/// URLs arrive from clickable terminal output, which is untrusted text, so
/// only plain http(s) links are accepted and none reach a shell.
#[tauri::command(async)]
pub fn open_url(url: String) -> Result<(), AppError> {
    if !is_web_url(&url) {
        return Err(AppError::ConfigUnavailable(
            "Only http and https links can be opened".into(),
        ));
    }
    open_web_url(&url).map_err(|source| AppError::ProcessStart {
        program: "default browser".to_string(),
        cwd: PathBuf::from("."),
        source,
    })
}

fn is_web_url(url: &str) -> bool {
    let lower = url.get(..8).unwrap_or(url).to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://"))
        && url.len() <= 8192
        && !url.chars().any(|character| character.is_whitespace() || character.is_control())
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
fn open_web_url(url: &str) -> io::Result<()> {
    // ShellExecuteW hands the URL to its registered handler directly. Routing
    // it through `cmd /C start` let `&`, `|` and `^` in a clicked link run as
    // shell syntax, because argument quoting cannot make text safe for cmd.exe.
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    let wide = |value: &str| -> Vec<u16> {
        std::ffi::OsStr::new(value).encode_wide().chain(std::iter::once(0)).collect()
    };
    let operation = wide("open");
    let file = wide(url);
    // SAFETY: both strings are NUL-terminated and outlive the call; null
    // window, parameters and directory are documented as optional.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    // Values above 32 indicate success; lower values are error codes.
    let code = result as isize;
    if code > 32 {
        Ok(())
    } else {
        Err(io::Error::other(format!("ShellExecuteW failed with code {code}")))
    }
}

#[cfg(target_os = "macos")]
fn open_web_url(url: &str) -> io::Result<()> {
    Command::new("open").arg(url).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_web_url(url: &str) -> io::Result<()> {
    Command::new("xdg-open").arg(url).spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::is_web_url;

    #[test]
    fn only_plain_web_urls_can_be_opened() {
        assert!(is_web_url("http://localhost:3000/?a=1&b=2"));
        assert!(is_web_url("HTTPS://example.com/path"));
        assert!(!is_web_url("file:///C:/Windows/System32/calc.exe"));
        assert!(!is_web_url("javascript:alert(1)"));
        assert!(!is_web_url("http://x/ & calc"));
        assert!(!is_web_url("http://x/\ncalc"));
        assert!(!is_web_url("htt"));
    }
}
