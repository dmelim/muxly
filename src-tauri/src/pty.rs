//! Interactive PTY sessions for the bottom terminal drawer.
//!
//! Each open shell is tracked by an opaque `pty_id` chosen by the frontend.
//! Output is streamed through a Tauri `Channel` passed in at open time; lifecycle
//! end-of-stream is signalled via the `PTY_CLOSED` window event so the frontend
//! can listen once globally regardless of how many shells are open.

use crate::{
    error::AppError,
    events::{PtyClosedEvent, PtyOutputEvent, PTY_CLOSED},
};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::Arc,
    thread,
};
use tauri::{ipc::Channel, AppHandle, Emitter};

/// Live PTY session. Each field is independently locked because the writer,
/// master (resize), and killer are touched by different commands on different
/// threads — sharing one mutex would needlessly serialise resize behind writes.
struct PtySession {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

/// App-wide registry of open PTY sessions, keyed by `pty_id`.
#[derive(Default)]
pub struct PtyRegistry {
    sessions: Mutex<HashMap<String, Arc<PtySession>>>,
}

impl PtyRegistry {
    fn insert(&self, id: String, session: PtySession) {
        self.sessions.lock().insert(id, Arc::new(session));
    }

    fn get(&self, id: &str) -> Option<Arc<PtySession>> {
        self.sessions.lock().get(id).cloned()
    }

    fn remove(&self, id: &str) -> Option<Arc<PtySession>> {
        self.sessions.lock().remove(id)
    }

    /// Kill every live session. Used on app shutdown so the OS doesn't get
    /// orphan shell processes when the window closes.
    pub fn close_all(&self) {
        let sessions: Vec<_> = self.sessions.lock().drain().map(|(_, s)| s).collect();
        for session in sessions {
            let _ = session.killer.lock().kill();
        }
    }
}

pub fn open_pty(
    app: AppHandle,
    registry: &PtyRegistry,
    pty_id: String,
    rows: u16,
    cols: u16,
    cwd: Option<String>,
    on_output: Channel<PtyOutputEvent>,
) -> Result<(), AppError> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| AppError::ProcessStop(format!("openpty failed: {err}")))?;

    let (program, args) = default_shell();
    let working_dir = cwd
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(home_dir)
        .unwrap_or_else(|| PathBuf::from("."));

    let mut command = CommandBuilder::new(&program);
    for arg in &args {
        command.arg(arg);
    }
    command.cwd(&working_dir);
    // Hint xterm-compatible escape handling for tools that probe TERM.
    command.env("TERM", "xterm-256color");

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|err| AppError::ProcessStart {
            program: program.clone(),
            cwd: working_dir.clone(),
            source: std::io::Error::new(std::io::ErrorKind::Other, err.to_string()),
        })?;

    // Clone the reader and take the writer *before* the master moves into the
    // session struct — both methods take `&self` so the order is flexible, but
    // doing it here keeps ownership transitions obvious.
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| AppError::ProcessStop(format!("clone_reader failed: {err}")))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| AppError::ProcessStop(format!("take_writer failed: {err}")))?;
    let killer = child.clone_killer();

    let session = PtySession {
        writer: Mutex::new(writer),
        master: Mutex::new(pair.master),
        killer: Mutex::new(killer),
    };
    registry.insert(pty_id.clone(), session);

    // Output pump: streams the master's reader into the frontend Channel until
    // the child closes its end (EOF) or a read error. On exit, emits the
    // `pty_closed` window event so the frontend can mark the shell as gone.
    {
        let pty_id = pty_id.clone();
        let app = app.clone();
        thread::spawn(move || {
            pump_output(reader, &pty_id, &on_output);
            // The reader hit EOF — best-effort reap the child so we don't leak
            // a zombie. `wait` is blocking; this thread is exiting anyway.
            let _ = child.wait();
            let _ = app.emit(PTY_CLOSED, PtyClosedEvent { pty_id });
        });
    }

    Ok(())
}

fn pump_output(
    mut reader: Box<dyn Read + Send>,
    pty_id: &str,
    on_output: &Channel<PtyOutputEvent>,
) {
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                // The PTY emits arbitrary bytes (UTF-8 in practice, but a stray
                // half-character from a chunk boundary would otherwise abort
                // the stream). `from_utf8_lossy` substitutes U+FFFD instead.
                let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                if on_output
                    .send(PtyOutputEvent {
                        pty_id: pty_id.to_string(),
                        chunk,
                    })
                    .is_err()
                {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

pub fn write_pty(registry: &PtyRegistry, pty_id: &str, data: String) -> Result<(), AppError> {
    let session = registry.get(pty_id).ok_or_else(|| AppError::NotRunning {
        service_id: pty_id.to_string(),
    })?;
    let mut writer = session.writer.lock();
    writer
        .write_all(data.as_bytes())
        .map_err(|source| AppError::Io {
            action: "write to pty",
            source,
        })?;
    writer.flush().map_err(|source| AppError::Io {
        action: "flush pty",
        source,
    })?;
    Ok(())
}

pub fn resize_pty(
    registry: &PtyRegistry,
    pty_id: &str,
    rows: u16,
    cols: u16,
) -> Result<(), AppError> {
    let session = registry.get(pty_id).ok_or_else(|| AppError::NotRunning {
        service_id: pty_id.to_string(),
    })?;
    session
        .master
        .lock()
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| AppError::ProcessStop(format!("resize failed: {err}")))?;
    Ok(())
}

pub fn close_pty(registry: &PtyRegistry, pty_id: &str) -> Result<(), AppError> {
    if let Some(session) = registry.remove(pty_id) {
        let _ = session.killer.lock().kill();
    }
    Ok(())
}

/// Picks the shell to launch.
///
/// - **Windows**: `powershell.exe` (Windows PowerShell 5.1, always present on
///   modern Windows installs). PowerShell 7 / `pwsh.exe` is nicer but not
///   guaranteed, so we don't depend on it.
/// - **Unix**: `$SHELL` if set, otherwise `/bin/bash`.
fn default_shell() -> (String, Vec<String>) {
    if cfg!(target_os = "windows") {
        ("powershell.exe".to_string(), vec!["-NoLogo".to_string()])
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".to_string());
        (shell, vec![])
    }
}

fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
}
