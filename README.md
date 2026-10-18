<div align="center">

<img src="src-tauri/icons/128x128.png" width="88" alt="Muxly" />

# Muxly

**Run and watch all your dev processes from one desktop app.**

</div>

Muxly keeps your dev servers, watchers, and scripts in one window instead of a
pile of terminal tabs. Your services are listed on the left, their logs sit in
the middle, and details and actions are on the right. You set each service up
once, then start, stop, and follow it from there.

Built with Tauri 2, React, TypeScript, and xterm.js.
Developed by [Diethos](https://diethos.com).

## Download

Get the latest installers from
[GitHub Releases](https://github.com/dmelim/muxly/releases/latest).

| Platform | File |
|----------|------|
| Windows, x64 | `Muxly_<version>_x64-setup.exe` (recommended) or `Muxly_<version>_x64_en-US.msi` |
| macOS, Apple Silicon | `Muxly_<version>_aarch64.dmg` |

There are no builds for Intel Macs or Linux yet. You can try
[building from source](#building-from-source) there, but those platforms are
not tested.

The installers are not code-signed yet:

- **Windows** may show a SmartScreen or unknown-publisher warning. Choose
  **More info**, then **Run anyway**.
- **macOS** may block the first launch. Open **System Settings → Privacy &
  Security** and choose **Open Anyway**.

Each file's SHA-256 checksum is listed next to it on the release page. Close
Muxly before installing a new version; your services and settings are kept.

## Features

### Running services

- Define services with a program, arguments, working directory, environment,
  port, and group. Start, stop, or restart individual services, or start and
  stop a whole group.
- Stopping a service also stops everything it launched (Windows Job Objects,
  Unix process groups), so no orphaned processes are left holding ports.
- Optional auto-restart per service, with a cap so a crashing service does not
  loop forever.
- Muxly checks a service's port before launch and tells you what is holding it.
- A `preRun` command can run in the same shell first, so `nvm use`, a virtualenv,
  or a codegen step carries over to the main command.
- Pseudo-terminal mode (`usePty`) gives a service a real TTY, for dev servers
  like Vite, WXT, or Next that misbehave without one.
- Run history keeps run counts, failures, and timings in SQLite.

### Logs and terminals

- Live `stdout` and `stderr` in xterm.js terminals, with ANSI colour and a
  bounded buffer.
- Open services as tabs inside panels, split the workspace into several panels,
  and drag tabs between them. The layout is restored the next time you open
  Muxly.
- Search one terminal with `Ctrl/Cmd + F`, or every service's logs at once with
  `Ctrl/Cmd + Shift + F`.
- A built-in shell drawer at the bottom. Pick any shell Muxly finds installed,
  such as PowerShell, Command Prompt, or Git Bash on Windows.

### Organising

- Groups, profiles, and project pinning keep larger setups manageable. Drag
  services and groups to reorder them.
- Search the services list by name, group, program, or arguments.
- Custom service icons: emoji, built-in icons, or your own images.
- Import scans a project folder for `package.json` scripts and `Procfile`
  entries and pre-selects the long-running ones.

### Privacy, Git, and tools

- **Stream mode**, from the command palette (`Ctrl/Cmd + P`), keeps logs usable
  while masking paths, email addresses, external URLs, and anything you mark as
  sensitive. Useful when screen sharing or streaming.
- The Details panel shows the service's Git branch, uncommitted changes, and
  ahead/behind counts. You can switch local branches when the worktree is clean,
  and commit or push from a review dialog.
- Open a service's folder in your editor or file manager, or its port in the
  browser.
- Colour themes: Default, Midnight, and High Contrast presets, plus your own
  colours with contrast warnings.
- `services.json` is reloaded as soon as it changes, whether you edit it by hand,
  from a script, or through an AI agent.

## Configuration

Services are stored in a single `services.json` file in your OS app-config
folder. See **[docs/services-config.md](docs/services-config.md)** for the
schema, where the file lives on each OS, and how to add services from a script
or an AI agent.

Two Agent Skills are included for AI coding tools such as Claude Code and Codex:

- **[muxly-register-service](skills/muxly-register-service/)** registers a
  project as a Muxly service.
- **[muxly-manage-themes](skills/muxly-manage-themes/)** creates, inspects,
  applies, or repairs colour themes.

## Keyboard shortcuts

On macOS, use `Cmd` wherever the table says `Ctrl/Cmd`.

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + P` | Command palette |
| `Ctrl/Cmd + N` | New service |
| `Ctrl/Cmd + 1…9` | Open the Nth service |
| `Ctrl/Cmd + R` | Start or restart the focused service |
| `Ctrl/Cmd + S` | Stop the focused service |
| `Ctrl/Cmd + W` | Close the focused tab |
| `Ctrl/Cmd + K` | Clear the focused terminal |
| `Ctrl/Cmd + F` | Search the focused pane |
| `Ctrl/Cmd + Shift + F` | Search all logs |
| `Ctrl/Cmd + ←` / `→` | Show or hide the services / details panel |
| `Ctrl/Cmd + ↓` | Show or hide the shell drawer |
| `Ctrl/Cmd + Shift + S` | Mark the focused project as sensitive |
| `Ctrl/Cmd + Shift + ↓` | Cycle profiles |
| `Ctrl + C` | Interrupt the focused PTY service |
| `Ctrl + Shift + C` | Copy selected terminal text (Windows/Linux; `Cmd + C` on macOS) |
| `Esc` | Close search or a form |

Clicking a service opens it as a tab in the focused panel when tab opening is
enabled. `Ctrl/Cmd`-click opens it in a new panel instead.

## Building from source

You need **Node.js 24 LTS**, **Rust** (stable), and the
[Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform.

```bash
npm install
npm run tauri dev      # run the desktop app
```

Other commands:

```bash
npm run build          # type-check and build the frontend
npm run tauri build    # build installers for your platform
npm run dev            # frontend only, in a browser (no backend features)
```

Project layout:

```
src/         React and TypeScript frontend
src-tauri/   Rust backend: processes, run history, file watching
docs/        Configuration, design, and release notes
skills/      Agent Skills for AI coding tools
```

Tech stack: Tauri 2, React 19, TypeScript, Vite, Tailwind CSS v4, xterm.js 6,
react-resizable-panels, and SQLite.

## Documentation

- [docs/services-config.md](docs/services-config.md): the `services.json`
  schema and the guide for AI agents
- [docs/design.md](docs/design.md): design system (colour, type, components)
- [docs/releases.md](docs/releases.md): how releases are built and published
- [CHANGELOG.md](CHANGELOG.md): release history

## License

Muxly is source-available under the
[PolyForm Noncommercial 1.0.0](LICENSE) license. You can use, modify, and share
it for non-commercial purposes.
