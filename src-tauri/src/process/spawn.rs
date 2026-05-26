use super::platform::process_terminator;
use crate::{
    error::AppError,
    events::{
        OutputStream, ProcessExitedEvent, ProcessFailedEvent, ProcessOutputEvent,
        ProcessStartedEvent, PROCESS_EXITED, PROCESS_FAILED, PROCESS_STARTED,
    },
    history::HistoryDb,
    net::is_port_available,
    process::{
        configure_process_group, resolve_program, resume_child, ProcessRegistry, RunningProcess,
    },
    services::{config::resolve_cwd, config::ServicesConfigDir, ServiceConfig},
};
use std::{
    io::{BufReader, Read},
    process::{Command, Stdio},
    str, thread,
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

    // Pre-flight port check. We probe BEFORE spawning so we never half-start a
    // service whose port belongs to someone else; the user gets a clean error
    // and the conflicting process is left alone.
    if let Some(port) = service.port {
        if !is_port_available(port) {
            return Err(AppError::PortInUse {
                service_name: service.name,
                port,
            });
        }
    }

    let base_dir = config_dir.current();
    let cwd = resolve_cwd(&service.cwd, base_dir.as_deref())?;
    let mut command = Command::new(resolve_program(&service.program));
    command
        .args(&service.args)
        .current_dir(&cwd)
        .envs(&service.env)
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

    registry.insert(
        service.id.clone(),
        RunningProcess {
            terminator,
            stop_requested: false,
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
        },
    );

    if let Some(stdout) = stdout {
        spawn_output_reader(
            app.clone(),
            on_output.clone(),
            service.id.clone(),
            OutputStream::Stdout,
            stdout,
        );
    }

    if let Some(stderr) = stderr {
        spawn_output_reader(
            app.clone(),
            on_output,
            service.id.clone(),
            OutputStream::Stderr,
            stderr,
        );
    }

    let app_for_wait = app.clone();
    let service_id = service.id;
    thread::spawn(move || {
        let exit = child.wait();
        let requested = app_for_wait
            .try_state::<ProcessRegistry>()
            .and_then(|state| state.remove(&service_id))
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
                        code: status.code(),
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

fn spawn_output_reader<R>(
    app: AppHandle,
    on_output: Channel<ProcessOutputEvent>,
    service_id: String,
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
                            message: error.to_string(),
                        },
                    );
                    break;
                }
            }
        }
    });
}

#[derive(Default)]
struct Utf8ChunkDecoder {
    pending: Vec<u8>,
}

impl Utf8ChunkDecoder {
    /// Decode a fresh batch of bytes against any partial sequence carried over
    /// from the previous call. Real invalid bytes are replaced with U+FFFD;
    /// only a trailing incomplete sequence is buffered for the next read.
    fn decode(&mut self, bytes: &[u8]) -> Option<String> {
        let mut combined = Vec::with_capacity(self.pending.len() + bytes.len());
        combined.extend_from_slice(&self.pending);
        combined.extend_from_slice(bytes);
        self.pending.clear();

        let mut output = String::new();
        let mut cursor = 0usize;

        while cursor < combined.len() {
            match str::from_utf8(&combined[cursor..]) {
                Ok(rest) => {
                    output.push_str(rest);
                    break;
                }
                Err(error) => {
                    let valid_up_to = error.valid_up_to();
                    // Bytes [cursor..cursor + valid_up_to] are guaranteed valid UTF-8
                    // by `Utf8Error::valid_up_to`; `from_utf8_lossy` will not replace.
                    output.push_str(&String::from_utf8_lossy(
                        &combined[cursor..cursor + valid_up_to],
                    ));

                    match error.error_len() {
                        None => {
                            // Trailing incomplete sequence — buffer for next read.
                            self.pending
                                .extend_from_slice(&combined[cursor + valid_up_to..]);
                            break;
                        }
                        Some(invalid_len) => {
                            // Real invalid bytes — emit one replacement and continue scanning.
                            output.push('\u{fffd}');
                            cursor += valid_up_to + invalid_len;
                        }
                    }
                }
            }
        }

        non_empty(output)
    }

    /// Flush any buffered partial sequence at end-of-stream. Anything still
    /// pending is by definition incomplete and is emitted lossily.
    fn finish(&mut self) -> Option<String> {
        if self.pending.is_empty() {
            None
        } else {
            let chunk = String::from_utf8_lossy(&self.pending).to_string();
            self.pending.clear();
            non_empty(chunk)
        }
    }
}

fn non_empty(value: String) -> Option<String> {
    if value.is_empty() {
        None
    } else {
        Some(value)
    }
}

#[cfg(test)]
mod tests {
    use super::Utf8ChunkDecoder;

    #[test]
    fn decoder_preserves_split_emoji() {
        let mut decoder = Utf8ChunkDecoder::default();
        let bytes = [
            b'o', b'k', b' ', 0xf0, 0x9f, 0x98, 0x80, b' ', b'd', b'o', b'n', b'e',
        ];
        let expected =
            String::from_utf8(vec![0xf0, 0x9f, 0x98, 0x80, b' ', b'd', b'o', b'n', b'e']).unwrap();

        assert_eq!(decoder.decode(&bytes[..5]).as_deref(), Some("ok "));
        assert_eq!(
            decoder.decode(&bytes[5..]).as_deref(),
            Some(expected.as_str())
        );
        assert_eq!(decoder.finish(), None);
    }

    #[test]
    fn decoder_flushes_incomplete_sequence_lossily_at_eof() {
        let mut decoder = Utf8ChunkDecoder::default();

        assert_eq!(decoder.decode(&[0xf0, 0x9f]), None);
        assert_eq!(decoder.finish().as_deref(), Some("\u{fffd}"));
    }

    #[test]
    fn decoder_buffers_trailing_partial_after_midbuffer_invalid() {
        // ok<INVALID>ok<PARTIAL EMOJI HEAD>
        // Previously, the whole buffer was lossy-decoded, replacing the trailing
        // partial sequence with U+FFFD. It must instead be buffered for the
        // next read so the emoji is decoded correctly.
        let mut decoder = Utf8ChunkDecoder::default();

        let chunk = decoder.decode(&[b'o', b'k', 0xff, b'o', b'k', 0xf0, 0x9f]);
        assert_eq!(chunk.as_deref(), Some("ok\u{fffd}ok"));

        // Feeding the remaining 2 bytes of the smiley completes the emoji.
        let rest = decoder.decode(&[0x98, 0x80]);
        assert_eq!(rest.as_deref(), Some("\u{1f600}"));
        assert_eq!(decoder.finish(), None);
    }

    #[test]
    fn decoder_handles_multiple_invalid_runs() {
        let mut decoder = Utf8ChunkDecoder::default();
        let chunk = decoder.decode(&[b'a', 0xff, 0xff, b'b', 0xfe, b'c']);
        // Each contiguous invalid run emits a single replacement char,
        // matching `String::from_utf8_lossy`'s behavior.
        assert_eq!(chunk.as_deref(), Some("a\u{fffd}\u{fffd}b\u{fffd}c"));
    }
}
