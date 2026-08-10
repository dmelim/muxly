//! Recovering the user's real `PATH` when the app was launched from the GUI.
//!
//! A process started by Finder, the Dock, or Spotlight inherits its environment
//! from `launchd`, not from a shell. In practice that means `PATH` is roughly
//! `/usr/bin:/bin:/usr/sbin:/sbin` — no Homebrew, no nvm, no Volta, no pyenv.
//! The same applies to a Linux desktop launcher started by the session manager.
//! Windows has no equivalent problem: GUI processes there inherit the full
//! machine and user `PATH` from the registry, so this module is a no-op.
//!
//! The consequence is that a `services.json` that works perfectly when the app
//! is run from a terminal (`npm run tauri dev`) fails on every service the
//! moment the user opens the bundled app the normal way — `npm` is simply not
//! on the inherited `PATH`. The fix used by editors with the same problem is to
//! ask the user's login shell what it thinks `PATH` should be, once, and merge
//! that in.
//!
//! We run the shell as **interactive and login** (`-ilc`). Neither alone is
//! enough in the wild: zsh users conventionally put their version-manager hooks
//! in `~/.zshrc` (interactive only), while `~/.zprofile` and `~/.bash_profile`
//! are login only. If the interactive attempt fails — some setups object to an
//! interactive shell without a terminal — we retry as login-only rather than
//! giving up.

use parking_lot::{Condvar, Mutex};
use std::path::PathBuf;
use tauri::Manager;

/// Both shell probes are bounded to five seconds. Waiting slightly longer than
/// their combined budget guarantees the first requirements check or spawn sees
/// the final result instead of racing an in-progress probe.
const RESOLUTION_WAIT: std::time::Duration = std::time::Duration::from_secs(11);

/// The user's login-shell `PATH`, resolved once at startup.
///
/// `None` means the startup probe is still running; `Some` is its final result,
/// including an empty vector on Windows or when probing failed. Consumers wait
/// for that distinction so an in-progress probe cannot look like a genuinely
/// empty login-shell PATH.
pub struct LoginPath {
    paths: Mutex<Option<Vec<PathBuf>>>,
    ready: Condvar,
}

impl Default for LoginPath {
    fn default() -> Self {
        Self {
            paths: Mutex::new(None),
            ready: Condvar::new(),
        }
    }
}

impl LoginPath {
    pub fn paths(&self) -> Vec<PathBuf> {
        let mut paths = self.paths.lock();
        let deadline = std::time::Instant::now() + RESOLUTION_WAIT;
        while paths.is_none() {
            let remaining = deadline.saturating_duration_since(std::time::Instant::now());
            if remaining.is_zero() || self.ready.wait_for(&mut paths, remaining).timed_out() {
                break;
            }
        }
        paths.clone().unwrap_or_default()
    }

    fn set(&self, paths: Vec<PathBuf>) {
        *self.paths.lock() = Some(paths);
        self.ready.notify_all();
    }
}

/// Kick off the probe on a background thread and store the result.
///
/// Deliberately off the startup path: sourcing a real `~/.zshrc` can take a
/// noticeable fraction of a second (version managers, completion frameworks),
/// and none of it is needed until the user actually starts a service.
pub fn resolve_in_background(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let paths = resolve();
        if let Some(state) = app.try_state::<LoginPath>() {
            state.set(paths);
        }
    });
}

/// The resolved login-shell `PATH`. Waits for the bounded startup probe so the
/// first runtime scan, service start, or editor launch cannot race it. Empty
/// means the completed probe found nothing usable (or exceeded its budget).
pub fn login_paths(app: &tauri::AppHandle) -> Vec<PathBuf> {
    app.try_state::<LoginPath>()
        .map(|state| state.paths())
        .unwrap_or_default()
}

#[cfg(windows)]
fn resolve() -> Vec<PathBuf> {
    Vec::new()
}

#[cfg(not(windows))]
fn resolve() -> Vec<PathBuf> {
    let shell = login_shell();

    // Interactive+login first, login-only as the fallback. See the module note.
    for flags in [["-ilc"], ["-lc"]] {
        if let Some(path) = probe(&shell, flags[0]) {
            return split(&path);
        }
    }

    Vec::new()
}

/// Ask one shell for its `PATH`.
///
/// The value is bracketed by sentinels because rc files are noisy — they print
/// banners, MOTDs, version-manager chatter — and we need to find our answer in
/// whatever else lands on stdout. Returns `None` if the shell fails, times out,
/// or produces no sentinel-delimited value.
#[cfg(not(windows))]
fn probe(shell: &str, flags: &str) -> Option<String> {
    use std::process::{Command, Stdio};

    const BEGIN: &str = "__MUXLY_PATH_BEGIN__";
    const END: &str = "__MUXLY_PATH_END__";

    // fish stores PATH as a list, so "$PATH" would come back space-separated
    // instead of colon-separated. Its own `string join` produces the POSIX form.
    let expansion = if shell.ends_with("fish") {
        format!(r#"printf '{BEGIN}%s{END}' (string join ':' $PATH)"#)
    } else {
        format!(r#"printf '{BEGIN}%s{END}' "$PATH""#)
    };

    let child = Command::new(shell)
        .arg(flags)
        .arg(&expansion)
        // An interactive shell will try to read from stdin; give it an
        // immediate EOF so it can't sit waiting for input we'll never send.
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    let output = wait_with_timeout(child, std::time::Duration::from_secs(5))?;
    let text = String::from_utf8_lossy(&output);
    let start = text.find(BEGIN)? + BEGIN.len();
    let end = text[start..].find(END)? + start;
    let value = text[start..end].trim().to_string();

    (!value.is_empty()).then_some(value)
}

/// Collect a child's stdout, giving up after `timeout`.
///
/// `std::process::Child` has no timed wait, so the read happens on a helper
/// thread and we kill the child if it outstays the deadline. Without this a
/// pathological rc file — one that blocks on a prompt, or waits on a network
/// mount — would leak a stuck process for the lifetime of the app.
#[cfg(not(windows))]
fn wait_with_timeout(
    mut child: std::process::Child,
    timeout: std::time::Duration,
) -> Option<Vec<u8>> {
    use std::io::Read;
    use std::sync::mpsc;

    let mut stdout = child.stdout.take()?;
    let (tx, rx) = mpsc::channel();

    std::thread::spawn(move || {
        let mut buffer = Vec::new();
        let result = stdout.read_to_end(&mut buffer);
        let _ = tx.send(result.map(|_| buffer));
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(buffer)) => {
            let _ = child.wait();
            Some(buffer)
        }
        Ok(Err(_)) => {
            let _ = child.wait();
            None
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

/// The login shell to interrogate. `SHELL` is normally set even for GUI
/// launches (launchd seeds it from the user record), but the fallback matters
/// for the stripped-down environments where it isn't.
#[cfg(not(windows))]
fn login_shell() -> String {
    std::env::var("SHELL")
        .ok()
        .map(|shell| shell.trim().to_string())
        .filter(|shell| !shell.is_empty())
        .unwrap_or_else(|| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".to_string()
            } else {
                "/bin/bash".to_string()
            }
        })
}

/// Split a `PATH` value into existing directories, preserving order.
///
/// Non-existent entries are dropped: stale `PATH` entries are extremely common
/// in long-lived dotfiles, and every consumer of this list pays a filesystem
/// probe per entry per lookup.
#[cfg(not(windows))]
fn split(path: &str) -> Vec<PathBuf> {
    std::env::split_paths(path)
        .filter(|dir| !dir.as_os_str().is_empty() && dir.is_dir())
        .collect()
}

#[cfg(test)]
#[cfg(not(windows))]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::Arc;

    #[test]
    fn split_keeps_order_and_drops_missing_entries() {
        let value = format!(
            "/usr/bin:/definitely/not/a/real/directory/muxly::{}",
            "/bin"
        );

        let paths = split(&value);

        assert_eq!(
            paths,
            vec![PathBuf::from("/usr/bin"), PathBuf::from("/bin")]
        );
    }

    /// The whole point of the module: whatever the user's shell reports must
    /// come back as usable directories. Skipped rather than failed where no
    /// usable shell exists, so CI containers without one stay green.
    #[test]
    fn resolve_finds_the_system_binaries() {
        let paths = resolve();
        if paths.is_empty() {
            return;
        }

        assert!(
            paths.iter().any(|dir| dir == Path::new("/usr/bin")),
            "login shell PATH should contain /usr/bin, got {paths:?}"
        );
    }

    #[test]
    fn consumers_wait_for_the_in_progress_probe() {
        let login_path = Arc::new(LoginPath::default());
        let resolver = Arc::clone(&login_path);
        let expected = PathBuf::from("/usr/bin");

        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(50));
            resolver.set(vec![expected]);
        });

        let started = std::time::Instant::now();
        assert_eq!(login_path.paths(), vec![PathBuf::from("/usr/bin")]);
        assert!(
            started.elapsed() >= std::time::Duration::from_millis(40),
            "consumer returned before the resolver published its result"
        );
    }
}
