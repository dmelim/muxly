# services.json — configuration & agent guide

Muxly reads its services from a single JSON file. The app **watches
this file and live-reloads** — any change (from the in-app editor, your text
editor, a script, or an AI agent) appears immediately, no restart needed.

## Location

`services.json` lives in the OS app-config directory for identifier
`com.diethos.muxly`:

| OS      | Path                                                              |
|---------|-------------------------------------------------------------------|
| Windows | `%APPDATA%\com.diethos.muxly\services.json`               |
| macOS   | `~/Library/Application Support/com.diethos.muxly/services.json` |
| Linux   | `~/.config/com.diethos.muxly/services.json`               |

On first run the app seeds this file from the bundled `services.sample.json`.

## Schema

The file is a **JSON array** of service objects:

```json
[
  {
    "id": "web",
    "name": "Web App",
    "icon": { "type": "builtin", "value": "web" },
    "program": "npm",
    "args": ["run", "dev"],
    "cwd": "C:/code/my-app",
    "env": { "NODE_ENV": "development" },
    "port": 3000,
    "group": "my-app",
    "autoRestart": false
  }
]
```

| Field         | Type                  | Required | Notes |
|---------------|-----------------------|----------|-------|
| `id`          | string                | yes      | Unique. Characters: `a-z A-Z 0-9 . _ -`. |
| `name`        | string                | yes      | Display name. |
| `icon`        | object \| null        | no       | Optional service icon. See below. |
| `program`     | string                | yes      | Executable: `npm`, `node`, `python`, … On Windows, extensionless names resolve via PATH (`.cmd`/`.bat`/`.exe`). |
| `args`        | string[]              | no       | Defaults to `[]`. |
| `cwd`         | string                | yes      | Absolute, or relative to this file's directory. |
| `env`         | object<string,string> | no       | Extra environment variables. Defaults to `{}`. |
| `port`        | number \| null        | no       | 1–65535. Enables the "open in browser" action and port-conflict checks. |
| `group`       | string \| null        | no       | Sidebar grouping. |
| `autoRestart` | boolean               | no       | Re-spawn on crash (capped at 3/min). Defaults to `false`. |
| `autoPort`    | boolean               | no       | Treat `port` as a *preference*: if it's busy at launch, roll upward to the next free port (probing up to 64) instead of failing, and inject the chosen value into the process. Defaults to `false`. |
| `portEnvVar`  | string \| null        | no       | Name of the env var that receives the chosen port when `autoPort` is on. Defaults to `PORT`. Ignored when `autoPort` is off. The chosen port also replaces any `{port}` placeholder in `args`/`env`. |
| `usePty`      | boolean               | no       | Spawn the service attached to a pseudo-terminal instead of pipes. Required for dev servers (Vite, WXT, Next, Astro, …) whose hot-reload loop depends on a real TTY. Defaults to `false`. |
| `preRun`      | string \| null        | no       | Shell prelude run in the *same shell* immediately before the command (`<preRun> && <program> <args…>`), so its env changes carry over — e.g. `nvm use 24.4.0`, `source .venv/bin/activate`. Empty/absent spawns directly. |
| `profile`     | string \| null        | no       | Id of the profile this service belongs to (see [Settings](#settings) → `profiles`). Absent/empty = unassigned, which shows under every profile. A deleted profile id is treated as unassigned. |
| `sensitive`   | boolean               | no       | Mask this service's name in the UI while "stream mode" is active, so the window is safe to screen-share. Defaults to `false`. |

Invalid configs (duplicate `id`, empty required fields, `port: 0`) are
rejected with an error — the previous good config keeps running. All fields
beyond `id`, `name`, `program`, and `cwd` are optional with safe defaults, so
older `services.json` files keep loading unchanged.

## Icons

Services can define an optional `icon`:

```json
{ "type": "emoji", "value": "⚙" }
{ "type": "builtin", "value": "globe" }
{ "type": "image", "path": ".muxly/icon.png" }
```

Built-in values: `terminal`, `globe`, `server`, `database`, `worker`,
`code`, `braces`, `package`, `boxes`, `cloud`, `lock`, `key`, `settings`,
`wrench`, `gauge`, `monitor`, `layers`, `route`, `git-branch`, `zap`,
`shield`, `bot`, `mail`, `file`, `folder`, `search`, `plug`, `network`,
`workflow`, `command`, `cpu`, and `hard-drive`.

Image paths can be absolute, or relative to the service `cwd`. Supported
formats are PNG, JPEG, WebP, GIF, and SVG. Images larger than 1 MB are ignored
by the UI and fall back to the default terminal icon.

## Settings

App preferences live in `settings.json` next to `services.json` in the same
OS app-config directory. Every field is optional with a default, so an older
or hand-written file keeps loading:

```json
{
  "editorCommand": "cursor",
  "hiddenProjectNames": { "my-app": true },
  "collapsedProjectNames": { "my-app": true },
  "pinnedProjectNames": { "my-app": true },
  "sensitiveProjectNames": { "my-app": true },
  "projectNameAliases": { "my-app": "alpha-tango-sierra-42" },
  "profiles": [{ "id": "day-job", "name": "Day job" }],
  "activeProfile": "day-job",
  "openPaneIds": ["api", "web"],
  "focusedPaneId": "web",
  "splitPaneIds": ["api", "web"],
  "workspacePanels": [
    { "id": "panel-a", "tabIds": ["api", "worker"], "activeTabId": "api" },
    { "id": "panel-b", "tabIds": ["web"], "activeTabId": "web" }
  ],
  "focusedPanelId": "panel-b",
  "openServicesInTabs": true,
  "themePreset": "custom",
  "theme": { "accent": "#22d3ee", "border": "#2a2d31" },
  "autoRestartMaxAttempts": 3,
  "autoRestartWindowMs": 60000,
  "maxLogChunks": 5000,
  "paneGridColumns": 5,
  "showTimestamps": true
}
```

| Field                    | Type                   | Notes |
|--------------------------|------------------------|-------|
| `editorCommand`          | string                 | Command used by "Open in editor". Defaults to `code.cmd` on Windows, `code` on macOS/Linux. |
| `hiddenProjectNames`     | object<string,bool>    | Projects marked `true` render with their persisted alias (manual sidebar eye toggle), regardless of stream mode. |
| `collapsedProjectNames`  | object<string,bool>    | Per-project collapsed (minimized) sidebar state, persisted across restarts. Absent = expanded. |
| `sensitiveProjectNames`  | object<string,bool>    | Projects flagged sensitive in Settings. Masked **only while stream mode is on** (distinct from `hiddenProjectNames`). |
| `projectNameAliases`     | object<string,string>  | Persisted random aliases used when a project name is hidden/masked. |
| `profiles`               | array of `{id, name}`  | The user's managed profiles. Empty = feature unused. Referenced by each service's `profile`. |
| `activeProfile`          | string \| null         | Id of the currently selected profile, or null/absent for "All profiles". Cleared if it doesn't match an existing profile. |
| `openPaneIds`            | array of strings       | Legacy flat list retained for backwards-compatible workspace restore. |
| `focusedPaneId`          | string \| null         | Focused service tab restored on launch. |
| `splitPaneIds`           | array of strings       | Legacy visible-panel list retained for backwards-compatible migration. |
| `workspacePanels`        | array of panel objects | Ordered panels. Each has `id`, ordered `tabIds`, and one `activeTabId`. Stale service IDs are ignored. |
| `focusedPanelId`         | string \| null         | Panel that receives normal service clicks and keyboard focus. |
| `openServicesInTabs`     | boolean                | Normal clicks open tabs inside the focused panel. Ctrl/Cmd-click creates a panel. Defaults to `true`. |
| `themePreset`            | string                 | `default`, `midnight`, `high-contrast`, or `custom`. |
| `theme`                  | object<string,string>  | Optional semantic six-digit hex overrides. Keys and defaults are documented in `docs/design.md`. |
| `autoRestartMaxAttempts` | number                 | Max auto-restart attempts within the window. |
| `autoRestartWindowMs`    | number                 | Rolling window (ms) for the auto-restart cap. |
| `maxLogChunks`           | number                 | Per-service log-retention cap (ring-buffer size). |
| `paneGridColumns`        | number                 | Column cap before the open-pane grid wraps to a new row. |
| `showTimestamps`         | boolean                | Prepend a per-line `[HH:MM:SS]` marker in service panes. Defaults to `true`. |

Service names, commands, and working directories are never altered by these
settings — name masking is a display concern only.

## For agents — adding a service from a repo

To register a project, point at its repository and:

1. Determine its long-running command (the dev server) — typically the
   `dev` / `start` / `serve` script in `package.json`, or a `Procfile` line.
2. Append one object to the array in `services.json`:
   - `program`: the package manager (`npm`, `pnpm`, `yarn`, `bun`).
   - `args`: e.g. `["run", "dev"]`.
   - `cwd`: the absolute repo path.
   - `id`: a unique slug derived from the repo/script name.
   - `port`: the dev server's port if known.
   - `group`: the repo name, to cluster its services.
   - `icon`: optional; use an emoji, a built-in icon, or a local image path.
3. Write the file. The app reloads automatically.

The in-app **Import** panel does this interactively — it scans a folder for
`package.json` scripts and `Procfile` entries and pre-selects the
long-running ones.
