//! PTY-backed service spawning.
//!
//! Mirrors `spawn::spawn_process` but routes the child through `portable_pty`
//! so it sees a real TTY on stdin/stdout/stderr. Without that, tools like Vite
//! / WXT skip their stdin keypress handler (`process.stdin.isTTY === false`),
//! leaving nothing to pin the event loop across an HMR rebuild — the dev
//! server then exits cleanly with code 0 mid-reload. See `agents.md` /
//! `CHANGELOG.md` for the longer explanation.
//!
//! The emitted lifecycle events (`PROCESS_STARTED`, `PROCESS_OUTPUT`,
//! `PROCESS_EXITED`, `PROCESS_FAILED`) are identical to the pipe-based path so
//! the frontend doesn't need a parallel rendering code path. The only visible
//! difference for the user is that PTY output is merged into a single stream
//! (always tagged `Stdout`) — PTYs do not preserve the stdout/stderr split.

use super::platform::{pty_terminator, PtyKillHandle};
use crate::{
    error::AppError,
    events::{
        OutputStream, ProcessExitedEvent, ProcessFailedEvent, ProcessOutputEvent,
        ProcessStartedEvent, PROCESS_EXITED, PROCESS_FAILED, PROCESS_STARTED,
    },
    history::HistoryDb,
    process::{ProcessRegistry, RunToken, RunningProcess},
    services::{config::resolve_cwd, config::ServicesConfigDir, ServiceConfig},
};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::Arc,
    thread,
};
use tauri::{ipc::Channel, AppHandle, Emitter, Manager};

/// Initial PTY size, used until the pane reports its measured dimensions via
/// `service_pty_resize` on mount. A generous default keeps early startup
/// output (before the first resize lands) from wrapping awkwardly.
const DEFAULT_PTY_COLS: u16 = 120;
const DEFAULT_PTY_ROWS: u16 = 30;

/// A live PTY-backed service's master side. The `writer` feeds the child's
/// stdin so the UI can answer interactive prompts (Vite's `r`/`u`/`q`, etc.),
/// and `master` drives terminal resize. The child's killer lives separately in
/// `ProcessRegistry` via `ProcessTerminator::Pty` — this registry only owns the
/// IO half of the session.
struct ServicePtySession {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    /// The run this session belongs to. A fast restart reuses the `service_id`
    /// key, so the waiter that tears down the *previous* run must not drop the
    /// session the *new* run just inserted — it compares this token first.
    run_token: RunToken,
}

/// App-wide registry of live PTY-backed service sessions, keyed by service id.
///
/// Distinct from `pty::PtyRegistry` (interactive bottom-drawer shells): service
/// PTYs are keyed by the stable service id rather than a per-shell opaque id,
/// and their lifecycle owner is `ProcessRegistry`. An entry lives for the whole
/// run — the waiter thread in `spawn_service_pty` removes it once the child
/// exits, which drops the master and releases the pseudo-terminal.
#[derive(Default)]
pub struct ServicePtyRegistry {
    sessions: Mutex<HashMap<String, Arc<ServicePtySession>>>,
}

impl ServicePtyRegistry {
    fn insert(&self, service_id: String, session: ServicePtySession) {
        self.sessions.lock().insert(service_id, Arc::new(session));
    }

    fn get(&self, service_id: &str) -> Option<Arc<ServicePtySession>> {
        self.sessions.lock().get(service_id).cloned()
    }

    /// Drop the session for `service_id` only if it still belongs to `token`.
    /// A no-op when a newer run already replaced it, so a stale waiter can't
    /// EOF the live run's PTY by dropping its master out from under it.
    fn remove_if_token(&self, service_id: &str, token: RunToken) {
        let mut sessions = self.sessions.lock();
        if sessions
            .get(service_id)
            .is_some_and(|session| session.run_token == token)
        {
            sessions.remove(service_id);
        }
    }
}

/// Forward keystrokes from the UI to a PTY service's stdin. A service that
/// isn't running has no session — we treat that as a no-op rather than an
/// error so a stray keystroke against a stopped pane doesn't surface in the UI.
pub fn write_service_pty(
    registry: &ServicePtyRegistry,
    service_id: &str,
    data: String,
) -> Result<(), AppError> {
    let Some(session) = registry.get(service_id) else {
        return Ok(());
    };
    let mut writer = session.writer.lock();
    writer
        .write_all(data.as_bytes())
        .map_err(|source| AppError::Io {
            action: "write to service pty",
            source,
        })?;
    writer.flush().map_err(|source| AppError::Io {
        action: "flush service pty",
        source,
    })?;
    Ok(())
}

/// Resize a PTY service's terminal so tools that probe `COLUMNS`/`LINES` and
/// redraw against the window (TUIs, progress bars) match the pane. No-op when
/// the service isn't running.
pub fn resize_service_pty(
    registry: &ServicePtyRegistry,
    service_id: &str,
    rows: u16,
    cols: u16,
) -> Result<(), AppError> {
    let Some(session) = registry.get(service_id) else {
        return Ok(());
    };
    session
        .master
        .lock()
        .resize(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| AppError::ProcessStop(format!("service pty resize failed: {err}")))?;
    Ok(())
}

pub fn spawn_service_pty(
    app: AppHandle,
    registry: &ProcessRegistry,
    config_dir: &ServicesConfigDir,
    service: ServiceConfig,
    on_output: Channel<ProcessOutputEvent>,
) -> Result<(), AppError> {
    if registry.is_running(&service.id) {
        return Err(AppError::AlreadyRunning {
            service_name: service.name,
        });
    }

    // Resolve the effective port + command inputs (free-or-fail preflight for a
    // plain port; roll-and-inject for an auto-port service). Same as the pipe
    // path — see `process::port`.
    let resolved = super::port::resolve_spawn(&service)?;

    let base_dir = config_dir.current();
    let cwd: PathBuf = resolve_cwd(&service.cwd, base_dir.as_deref())?;

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: DEFAULT_PTY_ROWS,
            cols: DEFAULT_PTY_COLS,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|err| AppError::ProcessStart {
            program: service.program.clone(),
            cwd: cwd.clone(),
            source: std::io::Error::new(std::io::ErrorKind::Other, format!("openpty: {err}")),
        })?;

    // A non-empty `preRun` wraps the spawn in a shell so the prelude and the
    // command share one environment (see `process::shell`); otherwise we spawn
    // the program directly.
    let (program, args) = match super::shell::active_prelude(&service.pre_run) {
        Some(prelude) => super::shell::shell_prelude_command(prelude, &service.program, &resolved.args),
        None => (service.program.clone(), resolved.args.clone()),
    };

    // CommandBuilder is portable_pty's analogue of std::process::Command. It
    // does its own program lookup, so we pass the raw program name and let it
    // resolve through PATH — including .cmd/.bat on Windows.
    let mut command = CommandBuilder::new(&program);
    for arg in &args {
        command.arg(arg);
    }
    command.cwd(&cwd);
    for (key, value) in &resolved.env {
        command.env(key, value);
    }
    // Hint xterm-compatible escape handling for tools that probe TERM. Most
    // dev servers fall back to monochrome without this.
    if !resolved.env.contains_key("TERM") {
        command.env("TERM", "xterm-256color");
    }

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|err| AppError::ProcessStart {
            program: service.program.clone(),
            cwd: cwd.clone(),
            source: std::io::Error::new(std::io::ErrorKind::Other, err.to_string()),
        })?;

    let pid = child.process_id().unwrap_or(0);

    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|err| AppError::ProcessStop(format!("clone_reader failed: {err}")))?;
    // Take the writer so the UI can send keystrokes to the child. Both
    // `try_clone_reader` and `take_writer` borrow `&master`, so we do them
    // before moving the master into the session registry below.
    let writer = pair
        .master
        .take_writer()
        .map_err(|err| AppError::ProcessStop(format!("take_writer failed: {err}")))?;

    let killer: PtyKillHandle = Arc::new(Mutex::new(child.clone_killer()));
    // On Windows this also captures the child in a Job Object so stopping the
    // service reaps any grandchildren it spawns; elsewhere it's just the
    // killer. See `platform::pty_terminator`.
    let terminator = pty_terminator(killer, pid);

    // One token for this run, shared by the registry entry, the PTY session,
    // and the waiter below. A fast restart reuses `service.id`, so cleanup
    // compares this token to avoid the stale waiter dropping the new run.
    let run_token = registry.next_token();

    registry.insert(
        service.id.clone(),
        RunningProcess {
            terminator,
            stop_requested: false,
            run_token,
        },
    );

    // Stash the writer + master so `service_pty_write` / `service_pty_resize`
    // can reach this session by service id. The master must stay alive for the
    // whole run — dropping it EOFs the slave and kills the child — so the
    // waiter thread below removes this entry (dropping the master) only after
    // the child has exited.
    app.state::<ServicePtyRegistry>().insert(
        service.id.clone(),
        ServicePtySession {
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            run_token,
        },
    );

    // Record the run before announcing the start, matching the pipe path.
    if let Some(db) = app.try_state::<HistoryDb>() {
        db.record_start(&service.id);
    }

    let _ = app.emit(
        PROCESS_STARTED,
        ProcessStartedEvent {
            service_id: service.id.clone(),
            pid,
            run_token,
            port: resolved.port,
        },
    );

    // Output pump: PTY merges stdout/stderr into a single stream. Tag every
    // chunk as Stdout so TerminalPanes renders it through the same code path.
    {
        let service_id = service.id.clone();
        let on_output = on_output.clone();
        thread::spawn(move || {
            pump_output(reader, &service_id, run_token, &on_output);
        });
    }

    // Waiter: blocks on child.wait(), then drops the session (releasing the
    // master) and emits the lifecycle event.
    let app_for_wait = app.clone();
    let service_id = service.id;
    thread::spawn(move || {
        let exit = child.wait();

        // Only reclaim entries that still belong to *this* run. A fast restart
        // reusing `service_id` may have already inserted a newer run under the
        // same key; `remove_if_token` leaves that live run untouched.
        let requested = app_for_wait
            .try_state::<ProcessRegistry>()
            .and_then(|state| state.remove_if_token(&service_id, run_token))
            .map(|process| process.stop_requested)
            .unwrap_or(false);

        // Child has exited: drop the PTY writer/master, releasing the
        // pseudo-terminal. Done here, after `wait()`, so the master stayed
        // alive for the whole session — dropping it earlier would EOF the
        // slave and kill the child prematurely. Token-guarded so we never EOF
        // a newer run's master.
        if let Some(sessions) = app_for_wait.try_state::<ServicePtyRegistry>() {
            sessions.remove_if_token(&service_id, run_token);
        }

        match exit {
            Ok(status) => {
                let code: Option<i32> = if status.success() {
                    Some(0)
                } else {
                    Some(status.exit_code() as i32)
                };
                if let Some(db) = app_for_wait.try_state::<HistoryDb>() {
                    db.record_exit(&service_id, code, requested);
                }
                let _ = app_for_wait.emit(
                    PROCESS_EXITED,
                    ProcessExitedEvent {
                        service_id,
                        run_token,
                        code,
                        requested,
                    },
                );
            }
            Err(error) => {
                if let Some(db) = app_for_wait.try_state::<HistoryDb>() {
                    db.record_exit(&service_id, None, requested);
                }
                let _ = app_for_wait.emit(
                    PROCESS_FAILED,
                    ProcessFailedEvent {
                        service_id,
                        run_token,
                        message: error.to_string(),
                    },
                );
            }
        }
    });

    Ok(())
}

fn pump_output(
    mut reader: Box<dyn Read + Send>,
    service_id: &str,
    run_token: RunToken,
    on_output: &Channel<ProcessOutputEvent>,
) {
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                // PTY emits arbitrary bytes (UTF-8 in practice, but a stray
                // half-character from a chunk boundary would otherwise abort
                // the stream). `from_utf8_lossy` substitutes U+FFFD instead.
                let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                if on_output
                    .send(ProcessOutputEvent {
                        service_id: service_id.to_string(),
                        run_token,
                        stream: OutputStream::Stdout,
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
