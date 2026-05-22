# Changelog

All notable changes to Muxly are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Versioning policy

- **MAJOR** — breaking changes to the `services.json` schema or app behaviour.
- **MINOR** — new features, backwards-compatible.
- **PATCH** — bug fixes and internal changes with no user-visible feature change.

The version is declared in **three files that must always match**:

- `package.json` → `version`
- `src-tauri/Cargo.toml` → `[package] version`
- `src-tauri/tauri.conf.json` → `version`

When releasing: bump all three, move `[Unreleased]` items into a new dated
section, and tag the commit `vX.Y.Z`.

## [Unreleased]

### Added

- Added Muxly app icons generated from the project logo and configured them for Tauri bundling.

- `.gitignore` for local dependencies, build outputs, runtime data, logs, and
  editor/OS files.
- **Split view** — open multiple services side by side in resizable panes.
  Clicking a service card replaces the view; `Ctrl/Cmd`/`Shift`-click (or the
  card's split icon) opens it in an additional pane. Each pane has its own
  Start / Stop / Restart / Clear controls and a close button in its header,
  plus a focused-pane highlight; the inspector acts on the focused pane.
- **Live config reload** — the app watches `services.json` and reloads when it
  changes on disk, so edits from an agent, a script, or your editor appear
  instantly.
- **Tooltips** — custom hover tooltips on toolbar and sidebar buttons,
  replacing native `title` tooltips.
- **Suggested import entries** — the Import panel pre-selects long-running
  scripts (`dev`, `start`, `serve`, …) and all Procfile entries, and marks
  them with a "suggested" badge.
- `docs/services-config.md` — schema, file location, and an agent guide for
  adding services by editing `services.json` directly.
- **Collapsible & resizable sidebars** — toggle the services sidebar
  (`Ctrl/Cmd+B`) and the details inspector (`Ctrl/Cmd+Shift+B`) from header
  buttons or the keyboard, and drag either edge to resize it.

### Changed

- Regenerated app icons from `logo-m.png` using Tauri's icon generator.`r`n- Regenerated app icons from `Logo-fat.png` using Tauri's icon generator.`r`n- Regenerated app icons from `Logo-tall.png` using Tauri's icon generator for a proper multi-size Windows ICO.`r`n- Regenerated the transparent full app icon set from `Logo4.png`.
- Regenerated the full app icon set from `Logo3.png` with transparent backgrounds and sharpened small-size frames.
- Regenerated the full `Logo2.png` lockup icon set with explicit sharpened small-size frames.
- Regenerated the Muxly app icons from `Logo2.png` for comparison.
- Renamed the app and docs from Multi Terminal / multi-terminal to Muxly / muxly.
- Toolbar Start / Restart / Stop / Clear are now compact icon-only buttons.
  The Clear icon is a brush sweep.
- Per-terminal controls (Start / Restart / Stop / Clear) moved out of the
  global header and into each pane's own header bar, so it is unambiguous
  which terminal an action targets in split view. The header now carries only
  global controls — sidebar toggles and log search.

### Fixed

- Stray horizontal scrollbar (and the thin vertical bar it induced) along the
  window's bottom edge. `body` had a `min-width: 1024px` while `overflow:
  hidden` sat only on `body`, not `html` — so a window narrower than 1024px
  let `html` scroll. The redundant `min-width` is gone (the Tauri window
  already enforces a 1024px minimum) and `overflow: hidden` now covers the
  document root and the app shell.
- Black bar along the bottom of a terminal pane. xterm hardcodes
  `background-color: #000` on its viewport, so the partial row left below the
  last line (the terminal is sized to a whole number of rows) showed as a
  pure-black strip. The viewport now uses the terminal theme background and
  `overflow-x` is forced hidden so terminal output never scrolls sideways.
- Garbled / overlapping text when opening a new split pane — the terminal was
  sized and replayed before `react-resizable-panels` had applied the pane's
  final width. Terminal setup is now deferred until layout settles.
- Continuous flicker in terminal panes — the `ResizeObserver` watched the same
  element xterm rendered into, so `fit()` perturbed its box and re-triggered
  the observer in a loop. The observer now watches a separate wrapper element,
  and fits are debounced to one per frame.

## [0.1.0] - 2026-05-22

First coherent release — a local desktop command center for development
processes, built with Tauri 2, React, TypeScript and xterm.js. It replaces a
sprawl of terminal windows with one surface: services on the left, live logs
in the center, service details and actions on the right.

### Added

- **Service management** — define services (program, args, cwd, env, optional
  port, optional group) and start / stop / restart them individually.
- **Live logs** — stdout/stderr streamed from Rust over per-spawn
  `tauri::ipc::Channel`s into xterm.js, with ANSI colour and a bounded
  in-memory ring buffer. Lifecycle events stay on the global event bus.
- **Three-pane UI** — services sidebar, terminal view, details inspector,
  with a fixed-height layout and independently scrolling panels.
- **Service groups** — services render under their `group` in the sidebar,
  each with "Start all" / "Stop all" controls.
- **Edit / create / delete services** — in-app form, validated client-side
  (id uniqueness, port range, env format) and re-validated in the backend
  before writing to `app_config_dir/services.json`.
- **Import** — scan a project folder for `package.json` scripts (npm / pnpm /
  yarn / bun, detected from the lockfile) and `Procfile` entries, and import
  the selected ones as services.
- **Process-tree termination** — Windows Job Objects with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (children die with the app even on a
  crash); Unix process groups. Children are spawned `CREATE_SUSPENDED` on
  Windows and resumed only after job assignment, so grandchildren cannot
  escape the job.
- **Auto-restart on crash** — opt-in per service, capped at 3 retries per
  minute to avoid crash loops.
- **Port-conflict detection** — a service's port is probed before start and
  scanned on launch; conflicts show as a sidebar warning.
- **Run history** — SQLite-backed (`history.db`); the inspector shows total
  runs, failed runs, last run, and last failure.
- **Workspace actions** — open a service's folder in VS Code or the file
  manager, or open its `localhost` port in the browser.
- **Global log search** — search every service's log buffer
  (`Ctrl/Cmd+Shift+F`) and jump to a match.
- **Keyboard shortcuts** — start/restart, stop, clear, new service, jump to
  service by number, global search.
- **Consistent UI** — shared `Button` component (variants + sizes), an
  icon-only toolbar, and custom dark scrollbars.

### Engineering notes

- Rust backend split into focused modules (`commands`, `error`, `events`,
  `history`, `import`, `net`, `open`, `process/*`, `services/*`).
- Typed `AppError` enum (`thiserror`) serialised to `{ code, message }`.
- `parking_lot::Mutex` throughout (no poisoning on thread panics).
- UTF-8 output decoder buffers split multi-byte sequences across reads.
- Relative `cwd` resolves against the `services.json` directory, not the
  process working directory.
- 9 Rust unit tests (UTF-8 decoder, `resolve_cwd`, `validate_services`,
  import slug normalisation).

### Known limitations

- No production build (`tauri build`) has been verified yet.

[Unreleased]: https://example.com/muxly/compare/v0.1.0...HEAD
[0.1.0]: https://example.com/muxly/releases/tag/v0.1.0
