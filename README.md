<div align="center">

<img src="src-tauri/icons/128x128.png" width="88" alt="Muxly" />

# Muxly

**A local desktop command center for your development processes.**

</div>

Muxly replaces a sprawl of terminal windows with one surface: your services on
the left, live logs in the center, details and actions on the right. Define
your dev servers, watchers, and scripts once — then start, stop, and watch them
all from a single window.

Built with Tauri 2, React, TypeScript, and xterm.js.
Developed by [Diethos](https://diethos.com).

## Features

- **Service management** — define services (program, args, cwd, env, port,
  group) and start / stop / restart them individually.
- **Live logs** — real `stdout`/`stderr` streamed into xterm.js terminals with
  ANSI colour and a bounded in-memory buffer.
- **Split view** — open multiple services side by side in resizable terminal
  panes; each pane has its own controls.
- **Service groups** — group related services and start or stop a whole group
  at once.
- **Custom service icons** — use emoji, built-in icons, or local images to
  make larger workspaces easier to scan.
- **Import** — scan a project folder for `package.json` scripts and `Procfile`
  entries; long-running ones are pre-selected.
- **Process-tree termination** — child processes die with their service
  (Windows Job Objects, Unix process groups) — no orphans.
- **Auto-restart** — opt-in per service, capped to avoid crash loops.
- **Port-conflict detection** — a service's port is probed before launch.
- **Run history** — total runs, failures, and timing, persisted in SQLite.
- **Global log search** — search every service's log buffer at once, plus
  in-pane search (`Ctrl/Cmd + F`) within a single terminal's scrollback.
- **Command palette** — `Ctrl/Cmd + P` runs named actions, including **stream
  mode**, which masks services flagged sensitive so the window is safe to
  screen-share or stream.
- **Pseudo-terminal mode** — opt-in `usePty` spawn attaches a service to a real
  PTY so TTY-dependent dev servers (Vite, WXT, Next, …) survive HMR reloads.
- **Pre-run prelude** — an optional `preRun` command runs in the same shell
  before the service starts, so `nvm use`, venv activation, or codegen carry
  over to the main command.
- **Drag-to-reorder** — reorder services and groups in the sidebar; the order
  is persisted.
- **Profiles** — filter the sidebar to a chosen subset of services.
- **Live config reload** — edits to `services.json` (from an editor, a script,
  or an AI agent) apply instantly.
- **Workspace actions** — open a service's folder in your configured editor
  or the file manager, or open its port in the browser.
- **Window state persistence** — Muxly reopens at the previous window size and
  position.

## Getting started

### Prerequisites

- **Node.js 24 LTS**
- **Rust** (stable) and your platform's
  [Tauri prerequisites](https://tauri.app/start/prerequisites/)

### Install & run

```bash
npm install

# run the desktop app (React frontend + Rust backend)
npm run tauri dev
```

Other commands:

```bash
npm run build         # type-check and build the frontend
npm run tauri build   # produce a production desktop bundle
npm run dev           # frontend only, in a browser (backend features unavailable)
```

## Configuration

Services live in a single `services.json` file in the OS app-config directory.
Muxly watches that file and live-reloads on any change.

See **[docs/services-config.md](docs/services-config.md)** for the schema, the
per-OS file location, and a guide for adding services programmatically
(including from an AI agent).

To let an AI coding agent register projects for you, install the
**[muxly-register-service](skills/muxly-register-service/)** Agent Skill. To
create, inspect, apply, or repair semantic themes, use
**[muxly-manage-themes](skills/muxly-manage-themes/)**. Both skills work with
Claude Code, Codex, and other Agent-Skills-compatible tools.

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + ←` | Toggle the services panel |
| `Ctrl/Cmd + →` | Toggle the details panel |
| `Ctrl/Cmd + ↓` | Toggle the bottom shell drawer |
| `Ctrl/Cmd + P` | Open the command palette |
| `Ctrl/Cmd + R` | Start / restart the focused service |
| `Ctrl/Cmd + S` | Stop the focused service |
| `Ctrl/Cmd + K` | Clear the focused terminal |
| `Ctrl/Cmd + N` | New service |
| `Ctrl/Cmd + W` | Close the focused pane |
| `Ctrl/Cmd + F` | Search within the focused pane |
| `Ctrl/Cmd + Shift + F` | Search all logs |
| `Ctrl/Cmd + Shift + ↓` | Cycle profiles |
| `Ctrl/Cmd + 1…9` | Open the Nth service |
| `Esc` | Close search / forms |

`Ctrl/Cmd`-click a service card to open it in a separate terminal panel. A
normal click opens a tab inside the focused panel when tab opening is enabled.

## Project structure

```
src/         React + TypeScript frontend
src-tauri/   Rust backend — process management, run history, file watching
docs/        Configuration and design documentation
```

## Tech stack

Tauri 2 · React 19 · TypeScript · Vite · Tailwind CSS v4 · xterm.js 6 ·
react-resizable-panels · SQLite

## Documentation

- [docs/services-config.md](docs/services-config.md) — `services.json` schema and agent guide
- [docs/macos-alpha-launch.md](docs/macos-alpha-launch.md) — macOS alpha landing copy and release strategy
- [skills/](skills/) — agent-agnostic Agent Skills (e.g. registering a project as a service)
- [docs/design.md](docs/design.md) — design system (colour, typography, components)
- [CHANGELOG.md](CHANGELOG.md) — release history

## License

Muxly is source-available under the [PolyForm Noncommercial 1.0.0](LICENSE)
license — free to use, modify, and share for non-commercial purposes.
