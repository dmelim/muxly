# Process Robustness Plan

This plan tracks correctness and maintainability work for the Tauri process runner in `src-tauri/src/lib.rs` and the related frontend process state handling.

## Current Baseline

The current implementation already includes some of the reviewed Phase A changes:

- `stop_requested` is tracked in `RunningProcess`.
- `process_exited` includes `requested: bool`.
- The frontend maps requested exits to `stopped` instead of `failed`.
- stdout and stderr are streamed through a per-process Tauri `Channel<ProcessOutputEvent>`.
- relative service `cwd` values resolve against the directory of the loaded config file.

The remaining work is mostly robustness, validation, and structure.

## Priority 0: Confirm Existing Phase A Behavior

Goal: make sure the already-landed Phase A code is kept intentional while later refactors happen.

- Keep `ProcessExitedEvent.requested` as part of the lifecycle contract.
- Keep `Channel<ProcessOutputEvent>` for stdout and stderr.
- Keep sparse lifecycle notifications on global Tauri events.
- Keep config-relative `cwd` resolution.
- Add focused tests once the backend is split enough to make pure functions easy to test.

Acceptance criteria:

- A user-requested stop is represented as `stopped`, not `failed`.
- Output still streams to only the channel provided for that process start request.
- Relative `cwd` entries are interpreted relative to `services.json`, not the app process working directory.

## Phase B: Runtime Robustness

### 1. Replace Poisoning Mutexes

Issue: `std::sync::Mutex` poisoning can leave the process registry or config-dir state unavailable after a panic while holding a lock.

Plan:

- Add `parking_lot` as an explicit Rust dependency after checking release metadata and release age.
- Replace `std::sync::Mutex` with `parking_lot::Mutex` for `ProcessRegistry` and `ServicesConfigDir`.
- Remove lock-poisoning string errors where they become unreachable.

Acceptance criteria:

- A panic in one thread does not permanently disable start/stop operations.
- Registry access code no longer needs `map_err(|_| "Process registry is unavailable")`.

Dependency note:

- Before changing `Cargo.toml`, check the crate registry metadata and record the selected `parking_lot` version release age in the implementation summary.

### 2. Preserve UTF-8 Across Output Read Boundaries

Issue: `String::from_utf8_lossy(&buffer[..count])` can corrupt multi-byte UTF-8 characters when a read splits them across chunks.

Plan:

- Replace per-read lossy conversion with an incremental UTF-8 decoder helper.
- Keep incomplete trailing byte sequences in a small carry buffer.
- Flush remaining bytes lossily only at EOF.
- Keep ANSI escape handling unchanged; this change only prevents UTF-8 replacement artifacts.

Acceptance criteria:

- Split multi-byte characters do not produce `U+FFFD` replacement characters.
- Existing ASCII and ANSI-colored output behavior is unchanged.
- Decoder logic is covered by unit tests with split emoji and non-Latin text.

### 3. Reduce PID-Reuse Risk

Issue: `stop_service` stores only a PID. Between reading the PID and killing the process tree, the original process could exit and the OS could reuse the PID for an unrelated process.

Plan:

- Introduce an owned process-control abstraction rather than treating PID as the only registry identity.
- On Unix, keep using a new process group and terminate by process group ID.
- On Windows, evaluate Job Objects as the target design because the job handle ties child lifetime to the spawned process tree more robustly than PID-only `taskkill`.
- As an intermediate step, keep `Child` ownership centralized so the wait path and stop path cannot race through detached PID-only state.

Acceptance criteria:

- The registry stores enough process ownership/control state to avoid PID-only stop semantics.
- Stop requests cannot accidentally target a newly reused PID after the original child has exited.
- Windows process trees are terminated through a job or another handle-backed mechanism, not plain PID-only lookup.

### 4. Make Window-Close Cleanup Non-Blocking

Issue: window-close cleanup currently terminates process trees sequentially on the close event path.

Plan:

- Move close cleanup to a short-lived background task.
- Terminate all tracked processes concurrently.
- Add a short total timeout for graceful cleanup.
- On Windows, prefer Job Objects so child processes are cleaned up even if the app process exits unexpectedly.

Acceptance criteria:

- Closing the window does not visibly stall on several running services.
- Best-effort cleanup still happens for every tracked process.
- The Windows design does not depend only on close-event code running successfully.

## Phase C: Config Correctness

### 5. App Config Directory Lookup

Issue: installed-app config should be persistent and writable, but the current lookup prefers `cwd/services.json` and then a bundled sample.

Plan:

- Change lookup order to:
  1. `app.path().app_config_dir()/services.json`
  2. `cwd/services.json`
  3. bundled `services.sample.json`
- Create the app config directory on first run.
- Decide whether first run should copy `services.sample.json` into app config or only read the sample as a fallback.

Acceptance criteria:

- An installed app has a stable writable config path.
- Development still supports `cwd/services.json`.
- The bundled sample remains read-only fallback data.

### 6. Validate Service Config

Issue: duplicate service IDs, empty command fields, and invalid paths can be accepted silently.

Plan:

- Add validation after JSON deserialization.
- Return all validation errors together rather than failing one at a time.
- Validate at least:
  - non-empty `id`
  - unique `id`
  - non-empty `name`
  - non-empty `program`
  - non-empty `cwd`
  - valid `port` range is already represented by `u16`, but reject port `0` if it is not meaningful
- Include the config path in error messages.

Acceptance criteria:

- Invalid config returns a clear error listing each problem.
- Duplicate IDs cannot reach the frontend state maps.
- Empty commands cannot reach `Command::new`.

## Phase D: Structure and Error Model

### 7. Split `lib.rs` Into Modules

Issue: process control, config loading, events, and commands are all in one file.

Plan:

- Keep `lib.rs` focused on `run()` and Tauri wiring.
- Introduce modules:
  - `commands.rs` for Tauri command entry points
  - `events.rs` for event payloads, stream enums, and event-name constants
  - `services/mod.rs` for `ServiceConfig` and validation
  - `services/config.rs` for path resolution and config load/save
  - `process/mod.rs` for registry types
  - `process/spawn.rs` for spawn and output-reader logic
  - `process/platform.rs` for Windows and Unix termination details

Acceptance criteria:

- `lib.rs` contains module declarations, state setup, command registration, window-close wiring, and `run()`.
- Platform-specific process behavior is isolated behind a small API.
- Adding restart, group operations, stdin, or port checks has an obvious module boundary.

### 8. Replace `Result<_, String>` With Structured Errors

Issue: stringly typed errors make frontend handling and Rust-side composition harder.

Plan:

- Add an `AppError` enum.
- Implement serialization suitable for Tauri command errors, with stable error codes and human-readable messages.
- Convert I/O, JSON, config validation, process lifecycle, and platform termination errors into `AppError`.
- Keep frontend-facing messages concise.

Acceptance criteria:

- Commands return structured errors with stable codes.
- The frontend can distinguish `already_running`, `not_running`, `config_invalid`, and unexpected failures.
- Repetitive `format!("Failed to ...")` boilerplate is reduced.

Dependency note:

- If adding `thiserror` explicitly, check crate registry metadata and record the selected version release age in the implementation summary.

### 9. Centralize Event Names and Stream Tags

Issue: event names are currently string literals at emit/listen sites.

Plan:

- Add constants for:
  - `process_started`
  - `process_exited`
  - `process_failed`
- Keep output on typed channels, not global event names.
- Keep `OutputStream` as a serialized enum for `stdout` and `stderr`.

Acceptance criteria:

- Event names are defined in one Rust module.
- Frontend event names are mirrored through TypeScript constants or a shared convention document.
- Stream tags remain type-safe in Rust and unchanged over IPC.

### 10. Revisit Desktop Crate Types

Issue: `crate-type = ["staticlib", "cdylib", "rlib"]` is the broader mobile-ready default and may be unnecessary for a desktop-only app.

Plan:

- Confirm intended targets.
- If desktop-only, reduce crate types to `["rlib"]`.
- Keep broader crate types if mobile support is planned.

Acceptance criteria:

- Build settings match product target.
- Any crate-type change is called out because it affects build artifacts.

## Phase E: Tests

Add focused unit tests around pure logic after the module split:

- `resolve_cwd` passes absolute paths through.
- `resolve_cwd` resolves relative paths against the config directory.
- service validation rejects duplicate IDs.
- service validation rejects empty `id`, `name`, `program`, and `cwd`.
- UTF-8 chunk decoder preserves split multi-byte characters.
- app config lookup chooses app config before dev `cwd` config before bundled sample.

Acceptance criteria:

- Tests cover the high-risk pure functions without requiring a running Tauri app.
- Platform-specific process termination remains covered by manual QA or integration tests because it depends on OS behavior.

## Suggested Implementation Order

1. Preserve and document existing Phase A behavior.
2. Add config validation.
3. Split modules around current behavior without changing semantics.
4. Add structured errors.
5. Replace mutexes with `parking_lot`.
6. Add UTF-8 carry-over decoding.
7. Add app config directory lookup and persistence path.
8. Rework process ownership to remove PID-only stop semantics.
9. Make close cleanup concurrent and timeout-bounded.
10. Revisit crate types.
11. Add focused unit tests as pure functions become isolated.

## Open Decisions

- Should first run copy `services.sample.json` into app config, or should the sample remain only a fallback until the user saves?
- Should Windows Job Objects be introduced before or after the module split?
- Should process restart and group start/stop wait for this robustness pass, or be implemented immediately after config validation?
- Should frontend errors be rendered directly from backend messages, or mapped by stable error codes?
