---
name: muxly-register-service
description: Register the current project or another local repo as a service in Muxly by discovering long-running commands, locating the runtime services.json config for com.diethos.muxly, and safely appending a service entry. Use when the user asks to add, register, connect, run, monitor, or make a project/repo/app/service available in Muxly.
---

# Muxly Register Service

## Purpose

Register a local project with Muxly from any repo. Muxly reads services from the OS runtime config file for `com.diethos.muxly` and watches that file for live reloads.

Use a bundled helper for the final write unless the user explicitly asks for manual JSON editing:

- Windows sessions: prefer `scripts/Register-Service.cmd`. It invokes the PowerShell helper with per-process `-ExecutionPolicy Bypass`, avoiding machine/user policy changes.
- Git Bash, macOS, and Linux sessions: use `scripts/register-service.sh`.

## Workflow

1. Identify the project root.
   - Prefer the current working directory when it contains project files.
   - Otherwise find the nearest parent containing `.git`, `package.json`, `Procfile`, `docker-compose.yml`, `compose.yml`, `Cargo.toml`, `pyproject.toml`, or similar project metadata.

2. Discover the service command.
   - For Node projects, read `package.json` and prefer long-running scripts in this order: `dev`, `start`, `serve`, `watch`.
   - Pick the package manager from the lockfile: `pnpm-lock.yaml` -> `pnpm`, `yarn.lock` -> `yarn`, `bun.lockb` or `bun.lock` -> `bun`, otherwise `npm`.
   - For `Procfile`, use the first likely web/process entry.
   - For Docker Compose projects, prefer `docker compose up` from the repo root only when that is clearly the intended dev command.
   - If multiple plausible services exist, ask the user which one to register.

3. Infer fields.
   - `id`: unique slug, usually repo name plus role when needed, for example `my-app-web`.
   - `name`: short human-readable name, usually repo name or script role.
   - `icon`: optional. Use `{ "type": "builtin", "value": "globe" }` for web apps, `terminal`, `server`, `database`, or `worker` when appropriate.
   - `program`: executable, for example `npm`, `pnpm`, `yarn`, `bun`, `docker`.
   - `args`: command arguments as an array, for example `["run", "dev"]`.
   - `cwd`: absolute project path using the local OS path format.
   - `env`: optional object of extra environment variables, for example `{ "NODE_ENV": "development" }`.
   - `group`: repo name.
   - `port`: include only when known from scripts, env files, config, or common framework defaults.
   - `autoPort`: optional boolean. Set `true` only when `port` should be treated as a preferred starting port and Muxly may roll upward to the next free port at launch.
   - `portEnvVar`: optional string. Use with `autoPort` when the selected port must be injected under a name other than `PORT`.
   - `profile`: optional profile id. Omit unless the user explicitly wants the service assigned to a known Muxly profile.
   - `autoRestart`: default to `false` unless the user asks for restart behavior.
   - `usePty`: default to `false`, but set to `true` for dev servers, watch-mode tools, and interactive CLIs that need a TTY. The Rust field is `use_pty`, but `services.json` uses camelCase `usePty`.
   - `preRun`: optional shell prelude run before the command in the same shell, for example `nvm use 20` or `source .venv/bin/activate`. Use only when the command depends on environment changes made by the prelude.
   - `sensitive`: optional boolean. Set `true` only when the service name should be masked while Muxly stream mode is active.

4. Decide whether the service needs PTY mode.
   - Set `usePty: true` when the command is a Vite-based dev server or a framework wrapping Vite, including Vite, WXT, Astro, SvelteKit, Nuxt, Remix, SolidStart, Qwik, Analog, and similar tools.
   - Set `usePty: true` for `next dev`, watch-mode test runners such as `vitest`, `vitest --watch`, and `jest --watch`, and watcher commands such as `tsx watch`, `node --watch`, and `nodemon` when they run or spawn a dev server.
   - Set `usePty: true` for Storybook, `webpack-dev-server`, `react-native start`, and interactive CLIs or tools with keypress prompts, for example `wrangler dev`, `expo start`, or anything that displays "press r to reload" style controls. Muxly's PTY panes forward keystrokes to the process, so the user can actually drive these controls (answer `r`/`u`/`q` prompts, confirm dialogs) directly in the pane; pipe-mode (`usePty: false`) panes are read-only.
   - For package scripts, inspect the underlying `package.json` command before deciding. Treat `npm run dev`, `pnpm dev`, `bun run dev`, and `yarn dev` as PTY candidates when the script invokes any of the tools above.
   - Soft signals that should usually set `usePty: true`: script names containing `dev`, `watch`, `serve`, or `start` plus dependencies or config files for Vite, WXT, Next, Astro, Nuxt, SvelteKit, Remix, Storybook, webpack dev server, React Native, or similar frameworks; README mentions of hot reload, HMR, fast refresh, or file watching.
   - When in doubt, prefer `usePty: true` for any `dev`, `watch`, or `serve` script. Missing PTY mode can make these services silently exit with code 0 after the first hot reload; setting PTY unnecessarily is usually only a cosmetic output issue.
   - Leave `usePty: false` for builds, one-shot tests without watch mode, migrations, codegen, production-style servers with append-only logs, databases, compiled binaries, or commands that intentionally spawn detached/background child processes. PTY mode merges stdout and stderr, and stopping a PTY service only kills the immediate child.

5. Check the existing Muxly config before writing.
   - Windows: `%APPDATA%/com.diethos.muxly/services.json`
   - macOS: `~/Library/Application Support/com.diethos.muxly/services.json`
   - Linux: `${XDG_CONFIG_HOME:-~/.config}/com.diethos.muxly/services.json`
   - If the file does not exist, create it as an empty array through the helper script.
   - If the desired `id` already exists, choose a unique ID or ask before replacing it.

6. Register with the helper.
   - Call the helper from this skill's directory using a relative path (`scripts/...`). Do not hardcode an agent-specific install path such as `~/.codex/skills/...` or `~/.claude/skills/...`; resolve it from wherever this skill was loaded.
   - In Windows PowerShell or cmd, prefer `scripts/Register-Service.cmd` so `%APPDATA%` resolves through the native Windows environment and script execution policy does not block the helper.
   - In Git Bash, macOS, or Linux, use `scripts/register-service.sh`.
   - Prefer `--stdin` and pass one complete JSON object. Use `--stdin` or `--service-json` whenever setting fields that the convenience flag form does not expose, including `usePty`, `autoPort`, `portEnvVar`, `profile`, `preRun`, or `sensitive`.
   - Do not hand-edit JSON with string concatenation.
   - Do not claim the service was registered unless the helper exits successfully and prints JSON containing `configPath`, `id`, `count`, `ids`, and `service`.

Example:

```bash
# Run from this skill's directory.
printf '%s\n' '{"id":"web","name":"Web App","icon":{"type":"builtin","value":"globe"},"program":"npm","args":["run","dev"],"cwd":"C:/code/my-app","port":3000,"group":"my-app","autoRestart":false,"usePty":true}' \
  | ./scripts/register-service.sh --stdin
```

PowerShell example:

```powershell
# Run from this skill's directory; $PSScriptRoot is unavailable in an interactive shell, so use the relative path.
'{"id":"web","name":"Web App","icon":{"type":"builtin","value":"globe"},"program":"npm","args":["run","dev"],"cwd":"C:/code/my-app","port":3000,"group":"my-app","autoRestart":false,"usePty":true}' |
  & ".\scripts\Register-Service.cmd" -Stdin
```

## Helper Behavior

The helper scripts:

- Locates the OS config file automatically.
- Creates the config directory and `services.json` if missing.
- Requires `id`, `name`, `program`, and `cwd`.
- Normalizes missing `args` to `[]`, missing `env` to `{}`, and missing `autoRestart` to `false`.
- Accepts optional `icon`, `port`, `group`, `autoPort`, `portEnvVar`, `profile`, `autoRestart`, `usePty`, `preRun`, and `sensitive` when supplied in JSON input. Missing boolean fields are treated as `false` by Muxly.
- Boolean fields (`usePty`, `autoPort`, `sensitive`, `autoRestart`) must be JSON booleans (`true`/`false`), not strings. The helper coerces common string forms (`"true"`, `"1"`) defensively, but Muxly's parser is strict: an entry with a stringified boolean is silently dropped on load. Emit real booleans.
- Rejects duplicate IDs by default.
- Replaces an existing matching ID only when called with `--replace`.
- Reads BOM-prefixed JSON correctly.
- Writes UTF-8 without BOM.
- Writes pretty JSON atomically via a temporary file and rename.
- Reads the config back after writing and prints a JSON summary only after the service is present.

After writing, report the service `id`, command, cwd, and `configPath` from the helper output. The app watches the file and should reload without restart.
