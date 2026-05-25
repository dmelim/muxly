# Changelog

All notable changes to Muxly are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Versioning policy

- **MAJOR** â€” breaking changes to the `services.json` schema or app behaviour.
- **MINOR** â€” new features, backwards-compatible.
- **PATCH** â€” bug fixes and internal changes with no user-visible feature change.

The version is declared in **three files that must always match**:

- `package.json` â†’ `version`
- `src-tauri/Cargo.toml` â†’ `[package] version`
- `src-tauri/tauri.conf.json` â†’ `version`

When releasing: bump all three, move `[Unreleased]` items into a new dated
section, and tag the commit `vX.Y.Z`.

## [Unreleased]

### Added

- Service groups in the sidebar can now be collapsed and expanded from their
  group headers.
- Each project group name can now be hidden behind a persisted random alias
  from its sidebar group header.
- Service-form icon selection now offers a searchable grid of built-in icons
  with tooltip names, plus a Frimousse-powered emoji picker for emoji icons.
- The emoji picker now includes category shortcut icons that scroll directly
  to smileys, people, nature, food, travel, activities, objects, symbols, and
  flags.

### Fixed

- Service icon status dots are no longer clipped by the icon badge container.
- Long project group names now show their full value in a tooltip when the
  sidebar header truncates them.
- xterm scrollbar arrow controls are now fully hidden so stray arrow glyphs no
  longer appear in terminal corners.
- Service-form icon dropdowns now use a custom dark menu with restrained hover
  states instead of the browser's native select rendering.
- Service-form icon dropdown selected rows now use a quieter hover-like fill
  instead of an accent-colored selected state.
- The emoji picker popup is no longer clipped when opened from the compact
  value field.

### Changed

- The built-in icon picker now opens as a compact popover instead of expanding
  the full icon grid inline in the form.
- Removed the redundant "Workspace" eyebrow from the services sidebar header.
- Sidebar service cards no longer use a cyan left-border accent to mark
  selected/open state. Any card whose service is open in a terminal pane now
  gets the tinted card background, with a small cyan `square-terminal` icon
  pinned to the card's top-right corner. The "open in split view" hover
  affordance moved to the card's bottom-right corner so the open-in-pane
  indicator and the split button no longer overlap.

## [0.2.0] - 2026-05-24

### Added

- Added the PolyForm Noncommercial 1.0.0 license for source-available non-commercial use.

- Added Muxly app icons generated from the project logo and configured them for Tauri bundling.

- `.gitignore` for local dependencies, build outputs, runtime data, logs, and
  editor/OS files.
- **Split view** â€” open multiple services side by side in resizable panes.
  Clicking a service card replaces the view; `Ctrl/Cmd`-click (or the
  card's split icon) opens it in an additional pane. Each pane has its own
  Start / Stop / Restart / Clear controls and a close button in its header,
  plus a focused-pane highlight; the inspector acts on the focused pane.
- **Live config reload** â€” the app watches `services.json` and reloads when it
  changes on disk, so edits from an agent, a script, or your editor appear
  instantly.
- **Tooltips** â€” custom hover tooltips on toolbar and sidebar buttons,
  replacing native `title` tooltips.
- **Suggested import entries** â€” the Import panel pre-selects long-running
  scripts (`dev`, `start`, `serve`, â€¦) and all Procfile entries, and marks
  them with a "suggested" badge.
- `docs/services-config.md` â€” schema, file location, and an agent guide for
  adding services by editing `services.json` directly.
- **Collapsible & resizable sidebars** â€” toggle the services sidebar
  (`Ctrl/Cmd+←`) and the details inspector (`Ctrl/Cmd+→`) from header
  buttons or the keyboard, and drag either edge to resize it.
- `docs/design.md` — the Muxly design system: colour, typography, spacing,
  and component specs.
- `README.md` — project overview, feature summary, setup instructions, and
  keyboard-shortcut reference.
- **Custom service icons** — service configs can define emoji, built-in, or
  local image icons that render in the sidebar and inspector.
- **Configurable editor command** — the details panel can save the command used
  by "Open in editor" to app settings.
- **Window state persistence** — the desktop window restores its last size and
  position on launch.

### Changed

- Accent colour changed from emerald green to the brand cyan
  (`cyan-400` / `cyan-500`), matching the logo. Affects the primary button,
  focus rings, the running-state dot, selection and focused-pane highlights,
  drag dividers, the terminal cursor, Muxly's in-terminal chrome (the pane
  header and `[manager]` lifecycle lines, previously green), and the
  "suggested" import badge.
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
  global controls â€” sidebar toggles and log search.

### Fixed

- Duplicate tooltip on service cards — the card carried a native `title`
  attribute as well as the custom tooltip on its split-view button, so two
  tooltips appeared at once. The native `title` is removed.
- Tooltips clipped by the side panels. The hover tooltip was an
  `overflow: hidden` descendant of the centre panel, so it was cut off where
  it extended over a sidebar. It is now rendered through a portal to
  `document.body` with `position: fixed`, and its horizontal position is
  clamped so it never spills off-screen.
- Keyboard shortcuts not firing while a terminal pane was focused. xterm
  consumes Ctrl/Cmd key combinations and stops their propagation, so the
  global handler never saw them. The handler now runs in the capture phase
  (ahead of xterm) and excludes xterm's hidden helper textarea from its
  "is a text field" check, so shortcuts work even with a terminal focused.
- Stray horizontal scrollbar (and the thin vertical bar it induced) along the
  window's bottom edge. `body` had a `min-width: 1024px` while `overflow:
  hidden` sat only on `body`, not `html` â€” so a window narrower than 1024px
  let `html` scroll. The redundant `min-width` is gone (the Tauri window
  already enforces a 1024px minimum) and `overflow: hidden` now covers the
  document root and the app shell.
- Black bar along the bottom of a terminal pane. xterm hardcodes
  `background-color: #000` on its viewport, so the partial row left below the
  last line (the terminal is sized to a whole number of rows) showed as a
  pure-black strip. The viewport now uses the terminal theme background.
- Horizontal scrollbar inside terminal panes. `react-resizable-panels` forces
  `overflow: auto` inline on each panel's inner element, which overrode the
  `overflow-hidden` class and made the panel itself a scroll container. Panels
  now pass `style={{ overflow: "hidden" }}` (which the library merges over its
  own default) so a pane clips instead of scrolling â€” xterm owns its own
  scrolling. As defence in depth, xterm 6.0's own `ScrollableElement`
  horizontal scrollbar and scrollbar arrow buttons are hidden in CSS too.
- Garbled / overlapping text when opening a new split pane â€” the terminal was
  sized and replayed before `react-resizable-panels` had applied the pane's
  final width. Terminal setup is now deferred until layout settles.
- Continuous flicker in terminal panes â€” the `ResizeObserver` watched the same
  element xterm rendered into, so `fit()` perturbed its box and re-triggered
  the observer in a loop. The observer now watches a separate wrapper element,
  and fits are debounced to one per frame.

## [0.1.0] - 2026-05-22

First coherent release â€” a local desktop command center for development
processes, built with Tauri 2, React, TypeScript and xterm.js. It replaces a
sprawl of terminal windows with one surface: services on the left, live logs
in the center, service details and actions on the right.

### Added

- Added the PolyForm Noncommercial 1.0.0 license for source-available non-commercial use.

- **Service management** â€” define services (program, args, cwd, env, optional
  port, optional group) and start / stop / restart them individually.
- **Live logs** â€” stdout/stderr streamed from Rust over per-spawn
  `tauri::ipc::Channel`s into xterm.js, with ANSI colour and a bounded
  in-memory ring buffer. Lifecycle events stay on the global event bus.
- **Three-pane UI** â€” services sidebar, terminal view, details inspector,
  with a fixed-height layout and independently scrolling panels.
- **Service groups** â€” services render under their `group` in the sidebar,
  each with "Start all" / "Stop all" controls.
- **Edit / create / delete services** â€” in-app form, validated client-side
  (id uniqueness, port range, env format) and re-validated in the backend
  before writing to `app_config_dir/services.json`.
- **Import** â€” scan a project folder for `package.json` scripts (npm / pnpm /
  yarn / bun, detected from the lockfile) and `Procfile` entries, and import
  the selected ones as services.
- **Process-tree termination** â€” Windows Job Objects with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (children die with the app even on a
  crash); Unix process groups. Children are spawned `CREATE_SUSPENDED` on
  Windows and resumed only after job assignment, so grandchildren cannot
  escape the job.
- **Auto-restart on crash** â€” opt-in per service, capped at 3 retries per
  minute to avoid crash loops.
- **Port-conflict detection** â€” a service's port is probed before start and
  scanned on launch; conflicts show as a sidebar warning.
- **Run history** â€” SQLite-backed (`history.db`); the inspector shows total
  runs, failed runs, last run, and last failure.
- **Workspace actions** â€” open a service's folder in VS Code or the file
  manager, or open its `localhost` port in the browser.
- **Global log search** â€” search every service's log buffer
  (`Ctrl/Cmd+Shift+F`) and jump to a match.
- **Keyboard shortcuts** â€” start/restart, stop, clear, new service, jump to
  service by number, global search.
- **Consistent UI** â€” shared `Button` component (variants + sizes), an
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

[Unreleased]: https://github.com/dmelim/muxly/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/dmelim/muxly/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/dmelim/muxly/releases/tag/v0.1.0


