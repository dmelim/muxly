use super::platform::process_terminator;
use super::utf8::Utf8ChunkDecoder;
use crate::{
    error::AppError,
    events::{
        OutputStream, ProcessExitedEvent, ProcessFailedEvent, ProcessOutputEvent,
        ProcessStartedEvent, PROCESS_EXITED, PROCESS_FAILED, PROCESS_STARTED,
    },
    history::HistoryDb,
    process::{
        configure_process_group, resolve_program, resume_child, ProcessRegistry, RunningProcess,
    },
    runtime::{inject_fallback_path, resolve_from_fallbacks, search_paths},
    services::{config::resolve_cwd, config::ServicesConfigDir, ServiceConfig},
};
use std::{
    io::{BufReader, Read},
    process::{Command, Stdio},
    thread,
};
use tauri::{ipc::Channel, AppHandle, Emitter, Manager};

pub fn spawn_process(
    app: AppHandle,
    registry: &ProcessRegistry,
    config_dir: &ServicesConfigDir,
    service: ServiceConfig,
    on_output: Channel<ProcessOutputEvent>,
) -> Result<(), AppError> {
    // PTY-backed services go through a parallel spawn path so the child sees
    // a real TTY (see `spawn_pty.rs`). All other lifecycle handling — events,
    // registry, history, terminate-on-window-close — is shared.
    if service.use_pty {
        return super::spawn_service_pty(app, registry, config_dir, service, on_output);
    }

    if registry.is_running(&service.id) {
        return Err(AppError::AlreadyRunning {
            service_name: service.name,
        });
    }

    // Resolve the effective port + command inputs. For a plain `port` this is
    // the historical free-or-fail preflight; for an `auto_port` service it
    // rolls a busy port to the next free one and injects the chosen value into
    // args/env (see `process::port`). Done BEFORE spawning so we never
    // half-start a service whose port belongs to someone else.
    let mut resolved = super::port::resolve_spawn(&service)?;
    // Activated runtime fallbacks plus the login shell's PATH. The latter is
    // what makes a GUI-launched app able to find `npm` at all — see `shell_env`.
    let fallback_paths = search_paths(&app);
    inject_fallback_path(&mut resolved.env, &fallback_paths);

    let base_dir = config_dir.current();
    let cwd = resolve_cwd(&service.cwd, base_dir.as_deref())?;

    // A non-empty `preRun` wraps the spawn in a shell so the prelude and the
    // command share one environment (see `process::shell`). Otherwise we spawn
    // the program directly, keeping the Windows `.cmd`/`.bat` resolution.
    let (program, args): (std::ffi::OsString, Vec<String>) =
        match super::shell::active_prelude(&service.pre_run) {
            Some(prelude) => {
                let (sh, sh_args) =
                    super::shell::shell_prelude_command(prelude, &service.program, &resolved.args);
                (std::ffi::OsString::from(sh), sh_args)
            }
            None => {
                let program = resolve_from_fallbacks(&service.program, &fallback_paths)
                    .map(|path| path.into_os_string())
                    .unwrap_or_else(|| resolve_program(&service.program));
                (program, resolved.args.clone())
            }
        };

    let mut command = Command::new(&program);
    command
        .args(&args)
        .current_dir(&cwd)
        .envs(&resolved.env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    configure_process_group(&mut command);

    let mut child = command.spawn().map_err(|source| AppError::ProcessStart {
        program: service.program.clone(),
        cwd: cwd.clone(),
        source,
    })?;

    let pid = child.id();

    // Attach to the job (Windows) or capture the process group id (Unix).
    // On Windows the child was spawned with CREATE_SUSPENDED, so it has not
    // executed any user code yet; if anything below this point fails we kill
    // it and bail without ever resuming it.
    let terminator = match process_terminator(&child) {
        Ok(terminator) => terminator,
        Err(error) => {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
    };

    // Now safe to let the child run. Any grandchildren it forks from here on
    // inherit job membership on Windows and the process group on Unix.
    if let Err(error) = resume_child(&child) {
        let _ = terminator.terminate();
        let _ = child.wait();
        return Err(error);
    }

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();

    // One token for this run, shared by the registry entry and the waiter so a
    // fast restart reusing `service.id` can't have its entry reaped by the
    // previous run's waiter. See `ProcessRegistry::next_token`.
    let run_token = registry.next_token();

    registry.insert(
        service.id.clone(),
        RunningProcess {
            terminator,
            stop_requested: false,
            run_token,
        },
    );

    // Record the run before announcing the start, so a frontend that queries
    // history on the PROCESS_STARTED event always sees this run.
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

    if let Some(stdout) = stdout {
        spawn_output_reader(
            app.clone(),
            on_output.clone(),
            service.id.clone(),
            run_token,
            OutputStream::Stdout,
            stdout,
        );
    }

    if let Some(stderr) = stderr {
        spawn_output_reader(
            app.clone(),
            on_output,
            service.id.clone(),
            run_token,
            OutputStream::Stderr,
            stderr,
        );
    }

    let app_for_wait = app.clone();
    let service_id = service.id;
    thread::spawn(move || {
        let exit = child.wait();
        // Reclaim only if this run still owns the entry — a faster restart may
        // already have replaced it under the same `service_id`.
        let requested = app_for_wait
            .try_state::<ProcessRegistry>()
            .and_then(|state| state.remove_if_token(&service_id, run_token))
            .map(|process| process.stop_requested)
            .unwrap_or(false);

        match exit {
            Ok(status) => {
                if let Some(db) = app_for_wait.try_state::<HistoryDb>() {
                    db.record_exit(&service_id, status.code(), requested);
                }
                let _ = app_for_wait.emit(
                    PROCESS_EXITED,
                    ProcessExitedEvent {
                        service_id,
                        run_token,
                        code: status.code(),
                        signal: exit_signal(&status),
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

/// The signal that killed the child, named, or `None` for a normal exit.
///
/// A signal death leaves `status.code()` as `None`, so without this the UI has
/// nothing to show but the word "signal".
#[cfg(unix)]
fn exit_signal(status: &std::process::ExitStatus) -> Option<String> {
    use std::os::unix::process::ExitStatusExt;
    status.signal().map(super::platform::signal_name)
}

#[cfg(not(unix))]
fn exit_signal(_status: &std::process::ExitStatus) -> Option<String> {
    None
}

fn spawn_output_reader<R>(
    app: AppHandle,
    on_output: Channel<ProcessOutputEvent>,
    service_id: String,
    run_token: u64,
    stream: OutputStream,
    reader: R,
) where
    R: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut decoder = Utf8ChunkDecoder::default();
        let mut buffer = [0_u8; 8192];

        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    if let Some(chunk) = decoder.finish() {
                        let _ = on_output.send(ProcessOutputEvent {
                            service_id: service_id.clone(),
                            run_token,
                            stream,
                            chunk,
                        });
                    }
                    break;
                }
                Ok(count) => {
                    if let Some(chunk) = decoder.decode(&buffer[..count]) {
                        let _ = on_output.send(ProcessOutputEvent {
                            service_id: service_id.clone(),
                            run_token,
                            stream,
                            chunk,
                        });
                    }
                }
                Err(error) => {
                    let _ = app.emit(
                        PROCESS_FAILED,
                        ProcessFailedEvent {
                            service_id: service_id.clone(),
                            run_token,
                            message: error.to_string(),
                        },
                    );
                    break;
                }
            }
        }
    });
}

#[cfg(all(test, unix))]
mod tests {
    use super::exit_signal;
    use std::process::{Command, Stdio};

    /// End-to-end check of the pipe path's signal reporting: a real process,
    /// really killed, must come back named. Guards the `ExitStatusExt::signal`
    /// wiring, which is easy to get subtly wrong (a signal death reports
    /// `code() == None`, so nothing else would notice if this returned `None`).
    #[test]
    fn reports_the_signal_that_killed_the_process() {
        let mut child = Command::new("/bin/sh")
            .arg("-c")
            .arg("sleep 30")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn test process");

        // SAFETY: SIGKILL to a child we just spawned and still own.
        unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGKILL) };
        let status = child.wait().expect("reap child");

        assert_eq!(status.code(), None, "a signal death carries no exit code");
        assert_eq!(exit_signal(&status).as_deref(), Some("SIGKILL"));
    }

    #[test]
    fn reports_no_signal_for_a_clean_exit() {
        let status = Command::new("/bin/sh")
            .arg("-c")
            .arg("exit 3")
            .status()
            .expect("run test process");

        assert_eq!(status.code(), Some(3));
        assert_eq!(exit_signal(&status), None);
    }
}
