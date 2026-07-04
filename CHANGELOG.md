# Changelog

All notable changes to Muxly are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Versioning policy

- **MAJOR** — breaking changes to the `services.json` schema or app behaviour.
  While the version is `0.x`, breaking changes still bump **MINOR** (the `0.`
  prefix signals "not yet stable"); the first `1.0.0` is a deliberate stability
  commitment, made only when explicitly chosen, never as a reflex to a breaking
  change.
- **MINOR** — new features, backwards-compatible.
- **PATCH** — bug fixes and internal changes with no user-visible feature change.

Cut a **PATCH** as soon as a fix or small cluster of fixes lands in
`[Unreleased]`; do not hold bug fixes for the next feature release.

The version is declared in **three files that must always match**:

- `package.json` → `version`
- `src-tauri/Cargo.toml` → `[package] version`
- `src-tauri/tauri.conf.json` → `version`

When releasing: bump all three, move `[Unreleased]` items into a new dated
section, and tag the commit `vX.Y.Z`.

## [Unreleased]

## [0.4.0] - 2026-07-04

### Added

- **Drag-and-drop to reorder groups.** Each group header now has a grip handle
  (revealed on hover) you can drag to move the whole group — and all its
  services as a block — to a new position in the sidebar. A cyan line shows
  where it will land (above or below the hovered group, so a group can be moved
  to the very end, not just before another). This is a separate gesture from
  dragging a service card: services still drag between/into groups as before,
  and the two never interfere. Order persists to `services.json` (group order is
  derived from the order services appear in the file).

### Changed

- **Stream mode now redacts sensitive service paths and commands, not just
  names.** When Stream mode is on, services marked Sensitive replace their
  working directory, command text, terminal banner paths, replayed scrollback,
  live output, and details-panel paths with the project's stable alias. Raw log
  buffers stay unchanged so turning Stream mode off restores the original text.

- **Native context menu is suppressed on non-editable app chrome.** Right-clicking
  the sidebar or other chrome no longer shows the WebView's browser page menu
  (Back, Refresh, Save as, Print, More tools → Share) — options that are useless
  or actively harmful here (Refresh reloads the whole webview and wipes UI state,
  and collides with the Ctrl/Cmd+R "restart service" shortcut). The useful native
  menu (Cut/Copy/Paste/Select all/Emoji) is preserved where editing or selection
  matters: text inputs and xterm terminal panes. PROD-gated, so right-click
  "Inspect element" stays available in `tauri dev`.

### Fixed

- **PTY services no longer leak an orphaned dev server that keeps holding the
  port.** On Windows, stopping or restarting a service running in a
  pseudo-terminal could leave a grandchild process alive — typically the
  `next`/Turbopack worker that actually binds the port — so the restart found
  the port still taken and sat forever at "waiting for port N to come up" (with
  two dev servers racing each other's `.next` temp files). ConPTY spawns the
  child already running, so the immediate suspend-assign-resume the pipe path
  uses to keep grandchildren inside the Job Object isn't available; a worker
  forked in the gap before job assignment escaped and survived
  `TerminateJobObject`. The PTY stop path now runs `taskkill /PID <pid> /F /T`
  first — walking the live process tree by parent→child links, which the Job
  Object can't — and keeps the job terminate + killer as a backstop. (Pipe-mode
  services were never affected.)

- **Stopping a service no longer freezes the UI for a few seconds.** The
  `stop_service` command was synchronous, so Tauri ran it on the main thread —
  and the Windows PTY stop path blocks on `taskkill /F /T` while it walks the
  whole live process tree. For services with deep trees (a `cargo run` app, a
  `next` dev server) that `.status()` wait stalled the entire window until the
  tree died. The command is now `async` and the blocking kill runs on the
  blocking pool, so the button flips to "Stopped" and the log keeps draining
  while the tree is reaped.

- **Stopping a service now shows a visible in-progress indicator.** With the
  kill no longer blocking, a deep process tree can take a moment to fully die —
  so the pane header now surfaces that gap: the status dot pulses, a small
  "Stopping…" pill with a spinner appears next to the service name, and the Stop
  button is disabled until the exit lands (preventing a redundant second stop).
  Previously the only cue was a static orange dot that was easy to miss while
  reading the log.

## [0.3.0] - 2026-06-18

### Added

- **Profiles.** Group services into named profiles (e.g. Day job, Personal) and
  switch the sidebar to show one at a time via a switcher at the top of the
  services list. A service belongs to one profile or none — unassigned services
  show in every profile. Switching is a pure view filter: hidden services keep
  running, and a "N running in other profiles" hint reminds you when something is
  alive outside the current view. Manage profiles (create / rename / delete) in
  Settings; deleting a profile reassigns its services to unassigned rather than
  deleting them. Assign a service to a profile in the edit form. A **New
  profile** command in the command palette (Ctrl/Cmd+P) creates one by name and
  switches to it. Backward compatible — existing `services.json`/`settings.json`
  need no changes.
- **Details panel shows the service's enabled options.** An "Options" row lists
  any of Auto-roll port if busy, Auto-restart on crash, Run in pseudo-terminal,
  and Sensitive name that are turned on (as green text; disabled ones are
  omitted, "None" when nothing is on), so you can see the active flags without
  opening the edit form.

- **Auto-roll a busy port (opt-in port management).** A new per-service
  **Auto-roll port if busy** toggle turns the service's `port` into a
  *preference*: if it's already taken at launch, Muxly starts on the next free
  port (probing up to 64 ports upward) instead of failing. The chosen port is
  injected into the process so the two can never disagree — it's set as an
  environment variable (name configurable per service via **Port env var**,
  default `PORT`) and substituted for any `{port}` placeholder in the service's
  args and env values. The pane logs `port 3000 busy — using 3001 instead` when
  it rolls, the Inspector's "Open localhost:N" and Port row reflect the real
  bound port, and port-conflict flags/blocker probes are suppressed for
  auto-port services (a busy preferred port is expected, not an error). Adds
  `autoPort` and `portEnvVar` to the service schema (backward-compatible
  defaults: off / `PORT`) and a `port` field to the `process_started` event.
  Non-auto services are unchanged: a busy `port` is still a hard error and
  nothing is injected.
- **Collapsed projects stay collapsed across restarts.** Minimizing
  (collapsing) a project in the sidebar is now remembered between sessions —
  reopening the app no longer expands every project back open. The state lives
  in a new `collapsedProjectNames` settings field (backward-compatible default:
  all expanded), persisted the same way as the per-project name-privacy toggle.
- **Command palette + Stream mode.** A lightweight command palette
  (<kbd>Ctrl/Cmd+P</kbd> or the new ⌘ toolbar button) runs named actions from a
  registry. Its headline command, **Stream mode**, masks the names of services
  marked **Sensitive** (a new per-service checkbox in the service form) across
  the sidebar, pane headers, and global search — leaving icons visible — so the
  window is safe to screen-share. Toggling it again restores the names. The
  palette also exposes common toggles (search, bottom terminal, sidebars,
  settings, new service). Services can be flagged sensitive per-service in the
  service form, or curated all at once in a new **Sensitive services** section
  of the Settings view.
- **`preRun` shell prelude for services.** A new optional **Pre-run** field
  runs a command in the *same shell* immediately before the service command
  (`<preRun> && <command>`), so environment changes carry over — e.g.
  `nvm use 24.4.0`, `source .venv/bin/activate`, or `npm ci`. Empty leaves the
  direct-spawn behaviour unchanged; both the pipe and PTY spawn paths honour
  it. Tokens containing spaces must be quoted inside the field.
- **"Looks like a dev server?" PTY hint in the service form.** When a new or
  edited service's program/args match a dev-server or watch heuristic
  (`dev`, `watch`, `serve`, `start`, or tools like Vite, WXT, Next, Nuxt,
  Astro, SvelteKit, Remix, nodemon, vitest, wrangler, expo, storybook, …) and
  "Run in pseudo-terminal" is still off, an amber nudge with a one-click
  **Enable** appears under the checkbox. Catches the most common
  misconfiguration — a dev server that silently exits mid-hot-reload without a
  TTY — at creation time instead of after the confusing failure. The token set
  is kept in sync with the `muxly-register-service` skill.
- **Interactive PTY service panes.** Services run with `usePty` are now
  fully interactive in their pane, not just read-only: keystrokes are piped
  to the child's stdin (new `service_pty_write` command) and the pane keeps
  the PTY sized to match (new `service_pty_resize`), so you can answer
  Vite's `r`/`u`/`q` prompts and drive other interactive CLIs in place. PTY
  output now also renders correctly — `convertEol` is disabled for PTY panes
  (a real PTY already emits CRLF) and per-line timestamps are skipped for
  them, so ANSI colours, spinners, and clear-screen sequences are no longer
  corrupted by injected markers. The live writer/master for each PTY service
  is held in a new `ServicePtyRegistry`, keyed by service id, and released
  when the child exits. Pipe-mode services stay read-only — they have no
  writer to send input to.
- **Per-line timestamps** in service-pane output. Every new line is
  prefixed with a dim `[HH:MM:SS]` marker so you can correlate events
  during a long run or across multiple panes. Streamed chunks that arrive
  mid-line don't get a second marker — line-start tracking is kept per
  service so a buffered write split across packet boundaries still
  produces one marker per visible line. Toggle from
  Settings → Logs → *Prepend timestamps*; defaults to on.
- **Port-conflict recovery banner.** When a service exits abnormally and
  another process is still listening on its configured port (a common
  scenario with `next dev`, Vite, etc. — "Port X is in use by process Y"),
  the pane now shows an amber banner with two actions:
  - **Stop pid N and restart** — Muxly kills the foreign PID via
    `taskkill /F /T` (Windows) or `kill -TERM` (Unix), waits ~600ms for
    the socket to release, then re-spawns the service.
  - **Adopt running instance** — Muxly treats the foreign PID as if it
    were this service: status dot turns cyan, an "adopted · pid N" badge
    appears in the pane header, the Stop button kills that PID, and the
    Details inspector shows "Adopted (external pid N)". Muxly does not
    capture the adopted process's stdout/stderr (it didn't spawn it), so
    the pane log stays at the message that announced the adoption.
    Adoptions auto-clear when the port stops being held by the adopted
    PID, and the badge has its own ✕ to release the adoption without
    killing the process.

  Backed by two new Tauri commands: `find_port_holder(port)` (uses
  `netstat -ano` / `lsof -t` / `ss -lntp`) and `kill_pid(pid)`.
- **Decoded process exit codes.** When a service exits abnormally we now
  decode the OS-level exit status alongside the raw number — most usefully
  on Windows, where the kernel returns NTSTATUS values (e.g.
  `-1073741502` is now shown as `code -1073741502 (0xC0000142,
  STATUS_DLL_INIT_FAILED — a DLL failed to initialise during process
  startup…)`). Abnormal exits also colour the banner red so the diagnostic
  stands out from routine lifecycle messages. The Details inspector's
  *Last Exit* row gets the compact form
  (`-1073741502 (STATUS_DLL_INIT_FAILED)`).
- Clicking a hit in the global search modal now **flashes the destination
  pane** with a short amber background pulse and **opens the in-pane
  search bar pre-filled with the query**, so the matched phrase is
  highlighted in the terminal as soon as you land on the service.
- **Wrapping pane grid** — open terminal panes now lay out as a grid that
  wraps to a new row after a configurable column cap (Settings → Layout →
  *Pane grid columns*, default 5). Replaces the previous purely horizontal
  layout.

- **In-pane search** — `Ctrl/Cmd+F` opens a small find bar in the focused
  terminal pane (also reachable via a new search icon in the pane header).
  Powered by `@xterm/addon-search`. Enter / Shift+Enter step through matches;
  Esc closes. Match decorations and the overview-ruler ticks use the brand
  cyan.
- **Live-updating global search** — the global log search (`Ctrl+Shift+F`)
  now re-scans the live log buffers every 250 ms while open, so matches
  appear as services keep streaming output instead of being frozen at the
  moment the query was typed.
- Services can now be spawned attached to a **pseudo-terminal** via a new
  per-service `usePty` flag (toggled in the service form as "Run in
  pseudo-terminal"). Required for dev servers whose hot-reload loop depends
  on a real TTY — Vite, WXT, Next, Astro, SvelteKit, Nuxt, and similar tools
  silently exit with code 0 mid-rebuild when given plain pipes, because
  their stdin keypress handler (the keep-alive that pins the event loop
  across HMR cycles) is gated on `process.stdin.isTTY`. PTY-backed services
  emit the same lifecycle events as pipe-backed ones, so terminal-pane
  rendering, history, and termination flow unchanged. Off by default;
  existing `services.json` files continue to use the pipe path.
- A new full-screen **Settings** view (gear icon in the top toolbar, `Esc` to
  close) exposes the editor command, auto-restart max-attempts and window,
  per-service log retention, and a master "hide all project names" toggle.
  The editor command was moved here from the Details inspector.
- Services in the sidebar can now be reordered by drag-and-drop. Dragging a
  service onto another card inserts it just above (joining that card's group);
  dragging onto a group header appends it to the end of that group, updating
  the service's `group` in `services.json`.
- Service groups in the sidebar can now be collapsed and expanded from their
  group headers.
- Each project group name can now be hidden behind a persisted random alias
  from its sidebar group header.
- Service-form icon selection now offers a searchable grid of built-in icons
  with tooltip names, plus a Frimousse-powered emoji picker for emoji icons.
- The emoji picker now includes category shortcut icons that scroll directly
  to smileys, people, nature, food, travel, activities, objects, symbols, and
  flags.
- URLs printed in a service's terminal output (e.g. `http://localhost:3000`)
  are now clickable and open in the system browser.
- A built-in interactive shell drawer (`Ctrl/Cmd+↓` or the terminal icon in
  the top toolbar) opens an interactive PTY (powershell on Windows, `$SHELL`
  elsewhere) rooted at the user's home directory — useful for ad-hoc commands
  without leaving the app.
- `Ctrl/Cmd+W` closes the focused service pane (does not affect the built-in
  shell drawer).
- The bottom shell drawer's height is now drag-resizable from its top edge
  (clamped between 120px and ~80% of the window height).

### Changed

- **Unified, themed dropdowns.** Replaced the remaining native `<select>`
  controls with a single shared, app-styled dropdown (keyboard navigation,
  click-outside to close, a cyan check on the selected option). The service
  edit form's icon-type and profile pickers now share this look instead of
  rendering OS-native chrome.
- **Pane lifecycle controls use a single slot.** Start, Restart, and Stop now
  replace each other in the terminal pane header instead of showing separate
  Start and Stop buttons with one disabled.
- **Frontend component structure.** Split large app/form files into focused
  components and helpers for service forms, service icon inputs, sidebars, app
  utilities, and detail rows. Behaviour is intended to stay unchanged.
- **Sensitive services are now curated as a project tree.** The Settings list
  groups services under their project with a checkbox per project and per
  service. Marking a project or service sensitive hides/masks it **only while
  Stream mode is on** — sensitive project names show their alias and sensitive
  service names are masked to their last 3 characters; turning Stream mode off
  reveals them. This is independent of the sidebar eye toggle, which still hides
  a project name manually regardless of Stream mode. Checking a project also
  marks all of its services as a convenience, after which you can uncheck
  individual services without unchecking the project. While Stream mode is on,
  the curation list masks the names it controls (so it doesn't leak them on a
  shared screen) and exposes an eye button to reveal them temporarily for
  editing — the reveal starts hidden on entering Stream mode and resets on
  exit. Adds a `sensitiveProjectNames` field to settings (backward-compatible
  default).
- **Masked service names now keep their last 3 characters** (e.g.
  `••••tor`) instead of a fixed bullet run, so panes and cards stay
  distinguishable while Stream mode is on. Names of 3 characters or fewer are
  still fully masked.

- The in-pane search bar's match decorations switched from cyan to amber so
  hits stand out against the cyan focus ring / cursor / status indicators
  used elsewhere in the chrome.
- Clicking a service in the sidebar now **replaces the focused pane only**
  instead of wiping the whole layout. With panes 1,2,3 open and pane 2
  focused, clicking 4 yields 1,4,3. **Shift+click** adds the service as an
  additional pane (replacing the previous `Ctrl/Cmd+click` split shortcut).
  `Ctrl/Cmd+1..9` still jumps to a single pane.
- Sidebar group headers now tint the start/stop-all icons cyan and rose so the
  bulk actions are easier to scan against the neutral header row.
- The run-history SQLite table is pruned on startup to keep the most recent
  200 runs per service, bounding `history.db` growth over time.
- Removed the unused `md` button size; the `Button` default size is now `sm`,
  matching what the UI actually uses.
- The built-in icon picker now opens as a compact popover instead of expanding
  the full icon grid inline in the form.
- Removed the redundant "Workspace" eyebrow from the services sidebar header.
- Sidebar service cards no longer use a cyan left-border accent to mark
  selected/open state. Any card whose service is open in a terminal pane now
  gets the tinted card background, with a small cyan `square-terminal` icon
  pinned to the card's top-right corner. The "open in split view" hover
  affordance moved to the card's bottom-right corner so the open-in-pane
  indicator and the split button no longer overlap.

### Fixed

- **Buttons show the pointer cursor on hover again.** Tailwind v4's Preflight
  dropped the `cursor: pointer` rule v3 applied to buttons, leaving the default
  arrow on every control. A base style restores the pointer for enabled buttons
  and `role="button"` elements (cards, dropdown triggers).
- **Terminal search no longer blanks the app on addon errors.** In-pane search
  enables xterm's proposed decoration API and catches SearchAddon failures, with
  a root error boundary as a final fallback instead of an empty window.
- **Backspacing in Windows PTY panes no longer flashes the cursor at the prompt.**
  Standalone carriage-return chunks from ConPTY are now held briefly and merged
  with the following redraw chunk, avoiding the intermediate column-0 cursor
  paint while preserving the original PTY stream.
- **PTY pane input lands on the correct row.** The backend opens each PTY at a
  default 120×30 because it can't know the pane size until the child exists. The
  pane fitted xterm to its real (narrower) geometry on mount, but that resize was
  a no-op since the process wasn't running yet, and nothing re-fired afterwards —
  leaving the PTY's width disagreeing with xterm's. readline-driven REPLs (node,
  python) then computed cursor-relative redraws against the wrong width, so
  echoed input rendered on the wrong line. The measured size is now pushed to the
  PTY on `PROCESS_STARTED` so the two always agree.
- **Stale restart events no longer clobber the new run.** Service lifecycle and
  output events now include the run token, and the frontend ignores exit,
  failure, and output events from older runs once a newer run has started.
- **Restarting a service no longer hangs with a blank pane.** A stop→start of
  the same service could leave the new run started but producing no output (and
  unstoppable) until you stopped and started again. The previous run's waiter
  thread tears down by `service_id`, and on a fast restart it could remove the
  *new* run's registry entry and PTY session — dropping the master and killing
  the output pump out from under the live process. Each run now carries a
  monotonic run token and cleanup is a compare-and-remove, so a stale waiter
  can never clobber a newer run. Affects both the PTY and pipe spawn paths.
- **Garbled punctuation in the UI.** `App.tsx` and `ServiceForm.tsx` had been
  double-encoded (UTF-8 read as Windows-1252 and re-saved), so em dashes and
  curly quotes rendered as mojibake — most visibly in the command palette's
  Stream mode description and the "Sensitive name" form hint. Restored the
  intended characters and stripped the stray byte-order marks.
- **PTY services now kill their whole process tree on stop (Windows).**
  Previously, stopping a PTY-backed service killed only the immediate child,
  so any grandchildren it spawned could leak as orphans. `portable_pty`
  spawns the child for us (we can't set `CREATE_SUSPENDED` like the pipe
  path), so the spawner now re-opens the running child by PID and assigns it
  to a `KILL_ON_JOB_CLOSE` Job Object after the fact; terminating reaps the
  whole tree. If the Job Object can't be created or assigned, it degrades to
  the previous single-child kill. A narrow race remains for grandchildren
  forked in the moment before assignment (acceptable for dev servers, which
  don't fork that early). Unix PTY children are unchanged.

- Stopping PTY-backed services is less noisy on Windows: duplicate lifecycle
  listeners are cleaned up reliably in development, and the contradictory
  `pty kill failed: The operation completed successfully. (os error 0)`
  result is treated as a successful best-effort stop.
- The global search modal (`Ctrl+Shift+F`) no longer shows an empty results
  panel — and the divider beneath the input — while the query field is
  empty. The results panel only renders once the query reaches the
  minimum-length threshold.
- Release builds on Windows no longer open an extra black console window
  alongside the app. The Tauri scaffold's
  `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]`
  attribute was missing from `src-tauri/src/main.rs`, so the packaged binary
  was being linked against the console subsystem.
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

## [0.2.0] - 2026-05-24

### Added

- Added the PolyForm Noncommercial 1.0.0 license for source-available non-commercial use.

- Added Muxly app icons generated from the project logo and configured them for Tauri bundling.

- `.gitignore` for local dependencies, build outputs, runtime data, logs, and
  editor/OS files.
- **Split view** — open multiple services side by side in resizable panes.
  Clicking a service card replaces the view; `Ctrl/Cmd`-click (or the
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
- Regenerated app icons from `logo-m.png` using Tauri's icon generator.
- Regenerated app icons from `Logo-fat.png` using Tauri's icon generator.
- Regenerated app icons from `Logo-tall.png` using Tauri's icon generator for a proper multi-size Windows ICO.
- Regenerated the transparent full app icon set from `Logo4.png`.
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
  hidden` sat only on `body`, not `html` — so a window narrower than 1024px
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
  own default) so a pane clips instead of scrolling — xterm owns its own
  scrolling. As defence in depth, xterm 6.0's own `ScrollableElement`
  horizontal scrollbar and scrollbar arrow buttons are hidden in CSS too.
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

- Added the PolyForm Noncommercial 1.0.0 license for source-available non-commercial use.

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

[Unreleased]: https://github.com/dmelim/muxly/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/dmelim/muxly/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/dmelim/muxly/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/dmelim/muxly/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/dmelim/muxly/releases/tag/v0.1.0
