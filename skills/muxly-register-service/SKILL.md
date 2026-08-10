---
name: muxly-register-service
description: Register or repair the current project or another local repo as a service in Muxly by discovering long-running commands, resolving project runtime and version-manager requirements, locating the runtime services.json config for com.diethos.muxly, and safely writing a launchable service entry. Use when the user asks to add, register, connect, run, monitor, fix, or make a project/repo/app/service available in Muxly.
---

# Muxly Register Service

## Purpose

Register a local project with Muxly from any repo. Muxly reads services from the OS runtime config file for `com.diethos.muxly` and watches that file for live reloads.

This folder in the Muxly repository is the canonical skill source. When an agent installation is a symlink or junction to this folder, keep using the repository copy; do not create or maintain a divergent agent-specific copy. Treat [`../../docs/services-config.md`](../../docs/services-config.md) and the Muxly process implementation under `../../src-tauri/src/process/` as the product contract when behavior is unclear.

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
   - Inspect the selected package script rather than treating the script name as the command. Preserve package-manager execution when the script relies on lifecycle hooks or package-manager-provided environment variables.
   - For `Procfile`, use the first likely web/process entry.
   - For Docker Compose projects, prefer `docker compose up` from the repo root only when that is clearly the intended dev command.
   - If multiple plausible services exist, ask the user which one to register.

3. Resolve runtime requirements before constructing the service.
   - For Node projects, inspect `.nvmrc`, `.node-version`, `package.json.engines.node`, and the `packageManager` field when present. Prefer an exact version from `.nvmrc` or `.node-version`; do not silently turn a range such as `>=22` into an arbitrary pinned version.
   - Check that the chosen runtime and package-manager executable resolve in the environment Muxly will inherit. Do not register a bare executable that is already known not to resolve.
     - Windows: use native checks such as `nvm current`, `where node`, and `where npm.cmd`; also verify that an NVM for Windows `path` from `settings.txt` actually exists.
     - macOS/Linux: use `command -v node`, `command -v npm`, and `node --version`. Check whichever version manager is in play — `nvm current`, `fnm current`, `volta list node`, `asdf current nodejs`, `mise current node`.
     - macOS specifically: do not assume your own shell's `PATH` is what Muxly sees. When Muxly is launched from Finder or the Dock it inherits launchd's minimal `PATH`, which excludes Homebrew and every version manager. Muxly recovers the login shell's `PATH` for spawning, so a tool that resolves in the user's terminal will resolve — but a tool installed only into a *non-login, non-interactive* context will not.
   - If a required Node version is managed by a version manager, carry that requirement into the service instead of assuming the user's current global version:
     - Windows (NVM for Windows): set `preRun` to `nvm use <exact-version>` and use the native package-manager launcher such as `npm.cmd`. A non-empty `preRun` makes Muxly run the complete command through `cmd.exe`, which also avoids direct PTY spawning of a `.cmd`/`.bat` file.
     - macOS/Linux (shell-based nvm): source it before selecting the version, for example `export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"; nvm use <exact-version>`. A non-empty `preRun` on Unix runs the whole command through the user's non-interactive login shell (`$SHELL -lc`). It reads login profiles such as `~/.zprofile` and `~/.bash_profile`, but not interactive files such as `~/.zshrc` or `~/.bashrc`; explicitly source any version-manager or environment hook that lives there.
     - macOS/Linux (fnm, Volta, asdf, mise): these expose real executables or shims on `PATH` rather than needing shell activation, so prefer a version-pinned absolute `program` path over a `preRun`.
     - NVM for Windows changes a machine-wide symlink. If concurrent services may require different Node versions, prefer a version-pinned executable path. When the selected package script is only a thin `node path/to/script` launcher and bypassing the package manager preserves its behavior, use that version's absolute `node.exe` as `program` and the script path as `args`.
   - If activation would require elevation, prompt interactively, or cannot be made deterministic, stop and ask rather than writing a service that will fail unattended.
   - Validate the resolved runtime before writing. At minimum, confirm the exact runtime exists and that the constructed shell context can resolve the main executable. Do not start the long-running service merely to perform this preflight.

4. Infer fields.
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
   - `preRun`: optional shell prelude run before the command in the same shell, for example `export NVM_DIR="$HOME/.nvm"; source "$NVM_DIR/nvm.sh"; nvm use 24.4.0` or `source .venv/bin/activate`. Use it whenever runtime activation or another environment change is required for the main executable to resolve. The shell is `cmd /c` on Windows and the user's non-interactive login shell (`$SHELL -lc`) on macOS/Linux, so write the prelude in the syntax of the platform you are registering on and explicitly source hooks otherwise loaded only by interactive rc files.
   - `sensitive`: optional boolean. Set `true` only when the service name should be masked while Muxly stream mode is active.

5. Decide whether the service needs PTY mode.
   - Set `usePty: true` when the command is a Vite-based dev server or a framework wrapping Vite, including Vite, WXT, Astro, SvelteKit, Nuxt, Remix, SolidStart, Qwik, Analog, and similar tools.
   - Set `usePty: true` for `next dev`, watch-mode test runners such as `vitest`, `vitest --watch`, and `jest --watch`, and watcher commands such as `tsx watch`, `node --watch`, and `nodemon` when they run or spawn a dev server.
   - Set `usePty: true` for Storybook, `webpack-dev-server`, `react-native start`, and interactive CLIs or tools with keypress prompts, for example `wrangler dev`, `expo start`, or anything that displays "press r to reload" style controls. Muxly's PTY panes forward keystrokes to the process, so the user can actually drive these controls (answer `r`/`u`/`q` prompts, confirm dialogs) directly in the pane; pipe-mode (`usePty: false`) panes are read-only.
   - For package scripts, inspect the underlying `package.json` command before deciding. Treat `npm run dev`, `pnpm dev`, `bun run dev`, and `yarn dev` as PTY candidates when the script invokes any of the tools above.
   - Soft signals that should usually set `usePty: true`: script names containing `dev`, `watch`, `serve`, or `start` plus dependencies or config files for Vite, WXT, Next, Astro, Nuxt, SvelteKit, Remix, Storybook, webpack dev server, React Native, or similar frameworks; README mentions of hot reload, HMR, fast refresh, or file watching.
   - When in doubt, prefer `usePty: true` for any `dev`, `watch`, or `serve` script. Missing PTY mode can make these services silently exit with code 0 after the first hot reload; setting PTY unnecessarily is usually only a cosmetic output issue.
   - Leave `usePty: false` for builds, one-shot tests without watch mode, migrations, codegen, production-style servers with append-only logs, databases, compiled binaries, or commands that intentionally spawn detached/background child processes. PTY mode merges stdout and stderr into one stream, losing the split.
   - Stopping a service kills its whole process tree on both modes and both platforms — a Job Object plus `taskkill /T` on Windows, a process-group signal escalating from SIGTERM to SIGKILL on macOS/Linux. A command that deliberately detaches its children into a *new* process group or session is the exception: those survive, which is another reason to leave such commands on `usePty: false` and manage them explicitly.

6. Check the existing Muxly config before writing.
   - Windows: `%APPDATA%/com.diethos.muxly/services.json`
   - macOS: `~/Library/Application Support/com.diethos.muxly/services.json`
   - Linux: `${XDG_CONFIG_HOME:-~/.config}/com.diethos.muxly/services.json`
   - If the file does not exist, create it as an empty array through the helper script.
   - If the desired `id` already exists, choose a unique ID or ask before replacing it.
   - When repairing an existing entry, inspect its live `program`, `args`, and `preRun`. Use the helper's replacement mode only when the user asked to update or repair that service; do not append a duplicate.

7. Register with the helper.
   - Call the helper from this skill's directory using a relative path (`scripts/...`). Do not hardcode an agent-specific install path such as `~/.codex/skills/...` or `~/.claude/skills/...`; resolve it from wherever this skill was loaded.
   - In Windows PowerShell or cmd, prefer `scripts/Register-Service.cmd` so `%APPDATA%` resolves through the native Windows environment and script execution policy does not block the helper.
   - In Git Bash, macOS, or Linux, use `scripts/register-service.sh`.
   - Prefer `--stdin` and pass one complete JSON object. Use `--stdin` or `--service-json` whenever setting fields that the convenience flag form does not expose, including `usePty`, `autoPort`, `portEnvVar`, `profile`, `preRun`, or `sensitive`.
   - Do not hand-edit JSON with string concatenation.
   - Do not claim the service was registered unless the helper exits successfully and prints JSON containing `configPath`, `id`, `count`, `ids`, and `service`.

Example:

```bash
# Run from this skill's directory. `cwd` is an absolute path in the local OS
# format — POSIX here, `C:/code/my-app` on Windows.
printf '%s\n' '{"id":"web","name":"Web App","icon":{"type":"builtin","value":"globe"},"program":"npm","args":["run","dev"],"cwd":"/Users/me/code/my-app","port":3000,"group":"my-app","autoRestart":false,"usePty":true}' \
  | ./scripts/register-service.sh --stdin
```

PowerShell example:

```powershell
# Run from this skill's directory; $PSScriptRoot is unavailable in an interactive shell, so use the relative path.
'{"id":"web","name":"Web App","icon":{"type":"builtin","value":"globe"},"program":"npm.cmd","args":["run","dev"],"cwd":"C:/code/my-app","port":3000,"group":"my-app","autoRestart":false,"usePty":true,"preRun":"nvm use 24.4.0"}' |
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
