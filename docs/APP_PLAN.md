# Muxly App Plan

## Product Direction

Muxly is a local desktop command center for development processes. It should replace scattered terminal and VS Code windows with one predictable surface: services on the left, live logs in the center, and service actions/details on the right.

## Stack

- Desktop shell: Tauri 2 with Rust backend.
- Frontend: Vite, React, TypeScript, Tailwind CSS.
- Terminal/log rendering: xterm.js with a fit addon.
- Persistence, first pass: JSON config under the Tauri app data directory.
- Persistence, later: SQLite if config history, run history, or search indexing becomes useful.

## MVP

1. Config file for services:
   - id, name, command, cwd, env, optional port, optional group.
   - hand-editable JSON first.
2. Process lifecycle:
   - start, stop, restart one service.
   - start/stop all services in a group.
   - clean process-tree termination on Windows, macOS, and Linux.
3. Log streaming:
   - stdout and stderr streamed from Rust to the frontend.
   - xterm.js renders ANSI colors.
   - per-service bounded ring buffer to avoid unbounded memory growth.
4. Workspace actions:
   - open service folder in file explorer.
   - open service folder in VS Code.
   - open localhost URL when a port is configured.
5. Status model:
   - stopped, starting, running, stopping, exited, failed.
   - show exit code and last run time.

## Backend Design

- Keep a process registry in Rust keyed by service id.
- Use async process spawning and line/chunk streaming.
- Emit structured events to the frontend:
  - process_started
  - process_output
  - process_exited
  - process_failed
- Avoid sending huge arrays over IPC. Stream chunks and let the frontend maintain bounded buffers.
- Introduce process tree kill early. Windows npm scripts often leave child Node processes behind if only the wrapper dies.

## Frontend Design

- Left nav: services grouped by workspace or project.
- Center pane: selected service terminal, with search and clear controls.
- Right inspector: command, cwd, env summary, status, quick actions.
- Bottom or top compact toolbar: start all, stop all, filter failed, settings.
- Keep the UI dense and operational. No marketing page, no decorative dashboard cards.

## Implementation Phases

## Current Implementation Status

Phases 1, 2, and most of 3 are complete. The app is usable for daily development.

### Backend (Rust)
- Modular layout: `commands.rs`, `error.rs`, `events.rs`, `open.rs`,
  `process/{mod,spawn,platform}.rs`, `services/{mod,config}.rs`.
- Typed `AppError` (via `thiserror`) serialises to `{ code, message }`.
- `parking_lot::Mutex` everywhere (no poisoning).
- Commands: `load_services`, `save_services`, `start_service`, `stop_service`,
  `open_in_editor`, `open_in_file_manager`, `open_url`, `app_version`.
- Output streaming on per-spawn `tauri::ipc::Channel`; lifecycle events on the
  Tauri event bus.
- Windows process management: spawn with `CREATE_SUSPENDED`, attach to a Job
  Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, resume via
  `NtResumeProcess`. Atomic process-tree termination and OS-level cleanup on
  app crash.
- Unix process management: own process group + `kill -TERM` on the group.
- Window-close cleanup runs concurrent kills with a 3-second timeout.
- UTF-8 chunk decoder buffers trailing partial sequences across reads.
- Config lookup: `app_config_dir/services.json` → `cwd/services.json` →
  bundled sample (auto-copied on first run).
- `validate_services` rejects duplicate ids, empty required fields, and
  `port: 0` before save *and* load.
- 8 unit tests passing.

### Frontend (React / TypeScript / Tailwind / xterm.js)
- Three-pane layout: services sidebar / xterm.js terminal / details inspector.
- Services grouped by `group` in the sidebar with per-group Start all / Stop
  all controls.
- Per-service Start / Stop / Restart / Clear-log controls.
- In-app form to create / edit / delete services with client-side validation.
- Inspector quick actions: Open in VS Code, Open folder, Open localhost URL.
- Bounded log ring buffer (5000 chunks) per service.
- Stop reports as "Stopped"; crashes report as "Failed" with Restart button.

### Phase 1: Spike

- Replace mocked service data with a checked-in sample config.
- Add Rust command to load config.
- Add Rust command to start a single process.
- Stream stdout/stderr to xterm.js.
- Stop the process cleanly.

### Phase 2: Real Local Use ✅

- ✅ Edit/create service UI.
- ✅ Persist config in the app data directory.
- ✅ Group start/stop.
- ✅ Open in VS Code, open in explorer, open port URL.
- ✅ Bounded log buffer and log clear.

### Phase 3: Reliability

- ✅ Process tree termination across platforms (Job Objects + process groups).
- ✅ Crash detection and restart action.
- ⏳ Port conflict detection before start.
- ⏳ Startup recovery when the app opens and old processes are gone.

### Phase 4: Polish

- Keyboard shortcuts.
- Global search across visible logs.
- Saved layouts and service groups.
- Optional run history.
- Optional import from Procfile, package.json scripts, or docker compose.

## Key Risks

- Windows process trees are the main correctness risk.
- High-volume logs can melt a naive React state implementation.
- Shell quoting differs across platforms, so config should separate command and args once the MVP works.
- Environment handling can become messy. Keep env explicit and visible.

## Dependency Release Notes

Dependency versions were chosen to avoid freshly published packages where practical.

- `@tauri-apps/cli` is pinned to `2.11.1` because `2.11.2` was published on 2026-05-16, under the 7-day preference window.
- `@tauri-apps/api` uses `2.11.0`, published on 2026-04-30.
- `react` and `react-dom` use `19.2.6`, published on 2026-05-06.
- `@xterm/xterm` uses `6.0.0`, published on 2025-12-22.
- `@xterm/addon-fit` uses `0.11.0`, published on 2025-12-22.
- `tailwindcss` and `@tailwindcss/vite` use `4.3.0`, published on 2026-05-08.
- `vite` uses `8.0.13`, published on 2026-05-14.
- `@vitejs/plugin-react` uses `6.0.2`, published on 2026-05-14.
- `typescript` uses `6.0.3`, published on 2026-04-16.
- `@types/react` uses `19.2.0`, published on 2025-10-01.
- `@types/react-dom` uses `19.2.0`, published on 2025-10-01.
