# Polish & Backlog

Work that remains after the 0.1.0 feature set. None of it blocks daily use —
this is the "make it shippable and nicer" list, roughly prioritized.

## Shipping (do before sharing the app)

- [ ] **Real app icon.** `src-tauri/icons/icon.ico` is a 76-byte placeholder
      dropped in to unblock the Windows resource build. Generate a proper icon
      set (`.ico`, `.png`, `.icns`) — `tauri icon path/to/source.png` does all
      sizes from one image.
- [ ] **Verify the production build.** Only `cargo check` / `cargo test` /
      `tauri dev` have been run. Do a real `tauri build` and confirm the
      installer produces a working app — dev and bundled differ in resource
      paths, working directory, and plugin init.
- [ ] **Code signing.** Unsigned builds trip SmartScreen (Windows) and
      Gatekeeper (macOS). Needed before distributing to other people.
- [ ] **git init + `.gitignore`.** No repository exists yet. Ignore
      `node_modules/`, `dist/`, `src-tauri/target/`, `src-tauri/gen/`.

## Features from the original vision, not yet built

- [ ] **Custom service icons.** The original idea was a name *and an icon* per
      service. Currently services only have a status dot. Add an optional icon
      field (emoji or a small icon set) to `ServiceConfig` and the form.
- [ ] **Configurable editor.** "Open in VS Code" hardcodes the `code` CLI. The
      original ask was "VS Code or program of choice." Add a setting for the
      editor command.

## UX improvements

- [ ] **In-terminal search.** Global search exists; a per-terminal find
      (`Ctrl/Cmd+F`, `@xterm/addon-search`) would complement it for the
      focused service.
- [ ] **stdin support.** Processes are spawned with `stdin` null — you cannot
      answer a prompt or send input. Wire the terminal's input back to the
      child process.
- [ ] **Drag-to-reorder services** within and across groups, persisted to
      `services.json`.
- [ ] **Window state persistence.** Remember window size/position between
      launches (`tauri-plugin-window-state`).
- [ ] **Group button colour.** "Start all" / "Stop all" are neutral `ghost`
      buttons. Optionally reintroduce green/red via dedicated Button variants.
- [ ] **Settings panel.** A home for the editor command, theme, and future
      preferences.

## Engineering

- [ ] **Drop the unused `md` Button size** if nothing adopts it (currently
      every button uses `xs` / `sm` / `icon`).
- [ ] **Live-updating global search.** Results are a snapshot taken when the
      query changes; they do not update as logs stream in.
- [ ] **Run-history retention.** `runs` rows accumulate forever. Add a cap or
      a periodic prune.

## Maintenance reminders

- Keep the three version fields in sync — see the versioning policy in
  `CHANGELOG.md`.
- Update `CHANGELOG.md` under `[Unreleased]` as features land.
