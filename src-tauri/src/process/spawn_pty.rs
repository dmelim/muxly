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

use super::platform::PtyKillHandle;
use crate::{
    error::AppError,
    events::{
        OutputStream, ProcessExitedEvent, ProcessFailedEvent, ProcessOutputEvent,
        ProcessStartedEvent, PROCESS_EXITED, PROCESS_FAILED, PROCESS_STARTED,
    },
    history::HistoryDb,
    net::is_port_available,
    process::{ProcessRegistry, ProcessTerminator, RunningProcess},
    services::{config::resolve_cwd, config::ServicesConfigDir, ServiceConfig},
};
use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::{
    io::Read,
    path::PathBuf,
    sync::Arc,
    thread,
};
use tauri::{ipc::Channel, AppHandle, Emitter, Manager};

/// Initial PTY size. The frontend's TerminalPanes view is plain-text, not a
/// real terminal emulator, so the dimensions are mostly hints for tools that
/// probe `COLUMNS` / `LINES`. 80x24 is the universal default.
const DEFAULT_PTY_COLS: u16 = 120;
const DEFAULT_PTY_ROWS: u16 = 30;

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

    // Pre-flight port check, same as the pipe path — we never want to half-
    // start a service whose port belongs to someone else.
    if let Some(port) = service.port {
        if !is_port_available(port) {
            return Err(AppError::PortInUse {
                service_name: service.name,
                port,
            });
        }
    }

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

    // CommandBuilder is portable_pty's analogue of std::process::Command. It
    // does its own program lookup, so we pass the raw program name and let it
    // resolve through PATH — including .cmd/.bat on Windows.
    let mut command = CommandBuilder::new(&service.program);
    for arg in &service.args {
        command.arg(arg);
    }
    command.cwd(&cwd);
    for (key, value) in &service.env {
        command.env(key, value);
    }
    // Hint xterm-compatible escape handling for tools that probe TERM. Most
    // dev servers fall back to monochrome without this.
    if !service.env.contains_key("TERM") {
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

    // The PTY master must stay alive for the duration of the session — drop
    // it and the slave gets EOF, killing the child. We don't need to interact
    // with it after spawn (no writes, no resize from the service path), so
    // stash it on a thread that just sleeps until child exit.
    let master = pair.master;

    let killer: PtyKillHandle = Arc::new(Mutex::new(child.clone_killer()));
    let terminator = ProcessTerminator::Pty(killer);

    registry.insert(
        service.id.clone(),
        RunningProcess {
            terminator,
            stop_requested: false,
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
        },
    );

    // Output pump: PTY merges stdout/stderr into a single stream. Tag every
    // chunk as Stdout so TerminalPanes renders it through the same code path.
    {
        let service_id = service.id.clone();
        let on_output = on_output.clone();
        thread::spawn(move || {
            pump_output(reader, &service_id, &on_output);
        });
    }

    // Waiter: blocks on child.wait(), then cleans up and emits the lifecycle
    // event. Owns the master so it survives until the child exits.
    let app_for_wait = app.clone();
    let service_id = service.id;
    thread::spawn(move || {
        let exit = child.wait();
        // Keep `master` alive until here — dropping earlier would close the
        // slave's controlling terminal and kill the child prematurely.
        let _ = master;

        let requested = app_for_wait
            .try_state::<ProcessRegistry>()
            .and_then(|state| state.remove(&service_id))
            .map(|process| process.stop_requested)
            .unwrap_or(false);

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
