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
- **Global log search** — search every service's log buffer at once.
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

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + ←` | Toggle the services panel |
| `Ctrl/Cmd + →` | Toggle the details panel |
| `Ctrl/Cmd + R` | Start / restart the focused service |
| `Ctrl/Cmd + S` | Stop the focused service |
| `Ctrl/Cmd + K` | Clear the focused terminal |
| `Ctrl/Cmd + N` | New service |
| `Ctrl/Cmd + Shift + F` | Search all logs |
| `Ctrl/Cmd + 1…9` | Open the Nth service |
| `Esc` | Close search / forms |

`Shift`-click a service card to open it in an additional split pane.

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
- [docs/design.md](docs/design.md) — design system (colour, typography, components)
- [CHANGELOG.md](CHANGELOG.md) — release history

## License

Muxly is source-available under the [PolyForm Noncommercial 1.0.0](LICENSE)
license — free to use, modify, and share for non-commercial purposes.
