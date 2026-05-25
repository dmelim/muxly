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

Invalid configs (duplicate `id`, empty required fields, `port: 0`) are
rejected with an error — the previous good config keeps running.

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
OS app-config directory. The editor command and project-name privacy mode are
configurable:

```json
{
  "editorCommand": "cursor",
  "hiddenProjectNames": {
    "my-app": true
  },
  "projectNameAliases": {
    "my-app": "alpha-tango-sierra-42"
  }
}
```

The default is `code.cmd` on Windows and `code` on macOS/Linux.
Projects marked `true` in `hiddenProjectNames` render with their persisted
aliases. Service names, commands, and working directories stay unchanged.

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
