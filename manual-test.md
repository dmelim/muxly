# Muxly 0.5.6 preview manual test

Test this checklist from the `preview/roadmap` working tree. Use disposable
services and repositories where a test can interrupt a process or switch a Git
branch. Never use a repository with uncommitted work for destructive-looking
branch tests.

## Preparation

- [ ] Start Muxly with at least two grouped services, two profiles, one
      ungrouped service, one pipe-mode service, and one PTY service.
- [ ] Give one sensitive service a project-local working directory but an
      executable under a user directory such as `C:\Users\<name>\AppData` on
      Windows or `/Users/<name>/.local` on macOS.
- [ ] Open two services, produce several screens of output, select terminal
      text, open in-pane search, and focus the second pane.
- [ ] Prepare a clean Git repository with two local branches and another Git
      repository with an uncommitted change.

## Stream mode privacy

- [ ] Enable Stream mode while panes are already open. Confirm service names,
      project names, commands, working directories, historical scrollback, live
      output, service-card commands, Details, and global-search results update
      immediately.
- [ ] Confirm the sensitive external executable path reveals neither the user
      name nor private parent directories. Test Windows backslashes, forward
      slashes, a quoted path containing spaces, and a POSIX-style path.
- [ ] Confirm pane order, focused pane, running PTY, search query, approximate
      scroll position, and terminal input remain usable after the toggle.
- [ ] Disable Stream mode and confirm real banners and scrollback return without
      closing or reopening panes and without duplicate or missing output.
- [ ] Remove or temporarily clear a project alias and confirm Stream mode uses a
      safe fallback instead of revealing raw paths.

## Terminal and service workflows

- [ ] Focus a running PTY service and press `Ctrl+C`. Confirm the foreground
      child receives an interrupt and Muxly does not force-kill the service.
- [ ] Select terminal text and press `Ctrl+C`; confirm the interrupt still
      arrives. On Windows/Linux, use `Ctrl+Shift+C` to copy the selection. On
      macOS, confirm `Cmd+C` still copies.
- [ ] Confirm `Ctrl+C` in a normal input, Settings, search, and the command
      palette does not interrupt a service. Confirm pipe-mode and stopped panes
      remain safe and the normal Stop button still works.
- [ ] Focus a grouped service and press `Ctrl/Cmd+Shift+S`. Confirm the project
      and every service in it become sensitive. Repeat it and confirm it never
      toggles sensitivity off.
- [ ] Repeat the sensitivity shortcut for an ungrouped service and confirm only
      that service changes. Confirm plain `Ctrl/Cmd+S` still stops a service.
- [ ] Press `Ctrl/Cmd+Shift+Down` repeatedly. Confirm profiles cycle in visible
      order, include All profiles, wrap, persist, and show brief feedback.
- [ ] Switch profiles while a service from another profile is focused. Confirm
      its pane, terminal state, search, and running process remain visible while
      the sidebar alone filters to the new profile.
- [ ] Start services in several profiles. Confirm the profile dropdown reports
      per-profile running counts and updates during starting, restarting,
      running, stopping, and exit transitions without exposing sensitive names.
- [ ] Trigger automatic restart. Confirm the card and pane use an amber,
      accessible `Restarting` state during backoff and return to Running or the
      appropriate failure state afterward.

## Workspace restore and tabs

- [ ] Open multiple panes, focus the second, quit normally, and relaunch.
      Confirm pane order and focus restore without auto-starting stopped services
      or pretending old terminal output was restored.
- [ ] Delete a configured service outside Muxly, relaunch, and confirm its stale
      pane ID is ignored while valid panes still restore.
- [ ] Force-close Muxly after changing panes, relaunch, and confirm the recent
      continuously persisted workspace is recovered.
- [ ] With **Open new services in tabs** enabled, normal-click several services.
      Confirm they become tabs inside the focused panel, do not create extra
      panels, and preserve each mounted terminal session when switching.
- [ ] Start with no `openServicesInTabs` key in `settings.json`. Confirm the
      option is enabled by default. Explicitly disable it, restart, and confirm
      the saved opt-out remains disabled.
- [ ] Ctrl/Cmd-click a service and confirm a separate panel appears with its own
      tab strip. Focus each panel and normal-click more services, confirming the
      new tabs enter only the focused panel. Close active and inactive tabs and
      confirm empty panels disappear, adjacent focus works, and processes keep
      running.
- [ ] Drag tabs within one panel and between two panels. Confirm the insertion
      preview and final order match the pointer position in macOS WKWebView as
      well as Windows, active terminals remain mounted, and an emptied source
      panel disappears without changing process state.
- [ ] Confirm each tabbed panel shows service identity and status only in its
      tab strip, with no duplicate name row. Confirm the tabs sit outside the
      frame while the service workspace below has a complete neutral outline
      that changes to soft cyan when focused.
      Confirm pane actions remain available in the toolbar below.
- [ ] Restart Muxly with two panels and multiple tabs in each. Confirm panel
      order, per-panel tab order, each active tab, and the focused panel restore.
      Confirm the older flat workspace fields migrate without losing services.

## Themes

- [ ] In Settings, preview Default, Midnight, and High Contrast. Confirm the app,
      panels, popovers, controls, focus rings, status colours, scrollbars, open
      service terminals, and bottom terminal update without restarting or
      disrupting terminal sessions.
- [ ] Change colours by six-digit hex value, reset one group, then Reset all.
      Close Settings without saving and confirm the saved theme returns.
- [ ] Open several colour swatches with mouse and keyboard. Confirm each picker
      stays inside the window, supports saturation, hue, arrow-key adjustment,
      outside-click and Escape closing, and keeps its hex field and live preview
      synchronized.
- [ ] Save a custom theme, restart Muxly, and confirm it persists. Remove some
      theme keys from `settings.json` and confirm missing values inherit safe
      defaults. Add invalid values and unknown keys and confirm the app remains
      readable and the settings file still loads.
- [ ] Create a low-contrast text/background pair. Confirm the warning appears
      and **Apply accessible text** corrects the primary text pairs.
- [ ] Test all process states and Stream mode under every preset. Confirm status
      is communicated through text as well as colour and privacy is unchanged.

## Git awareness and controls

- [ ] On macOS, launch the installed app from Finder rather than a terminal.
      Confirm Git detection works with the Apple system Git and, where
      available, a Homebrew Git found only through the login shell's `PATH`.
      Confirm a missing or unusable Git installation produces a non-fatal
      in-app explanation rather than being reported as a non-repository.
- [ ] Switch rapidly between services in different repositories while Git
      checks are running. Confirm the root, current branch, and dropdown always
      belong to the selected service, including after focus and timed refreshes.
- [ ] Put a service inside an ignored folder of a parent repository and confirm
      Muxly reports no repository. Confirm a tracked monorepo subdirectory still
      uses the legitimate parent repository.

- [ ] Select services inside a normal repository, nested directory, worktree,
      detached HEAD, dirty repository, clean repository, and non-repository.
      Confirm Details remains responsive and shows the correct non-fatal state.
- [ ] Confirm branch, dirty indicator, and local ahead/behind counts refresh on
      focus, the Refresh action, and the periodic refresh. On Windows, confirm
      none of these checks opens or flashes a console window.
- [ ] In a clean repository, switch between existing local branches and confirm
      the service's files change and the displayed state refreshes.
- [ ] In a dirty repository, attempt to switch and confirm Muxly refuses with an
      explanatory in-app message. Confirm it never stashes, resets, discards,
      fetches, pulls, stages, commits, or pushes.
- [ ] Enable Stream mode for a sensitive service and confirm repository paths
      and branch names are replaced with private labels. Confirm branch
      switching is unavailable until Stream mode is disabled.

## Side-panel groundwork

- [ ] Pin and unpin several projects. Confirm pinned project groups stay at the
      top after restart, preserve relative project and service order within the
      pinned and unpinned sets, and remain searchable and keyboard accessible.
- [ ] Open Settings and switch among General, Workspace, Appearance, and
      Privacy. Confirm unsaved values survive tab switches, each section is in
      the expected tab, and a search shows matching sections across all tabs.
- [ ] Confirm Settings tabs form a left-side rail, sensitive-service project
      rows start collapsed and expand independently without toggling their
      checkboxes, and the round floating save icon remains reachable without a
      bottom action bar.
- [ ] In Profiles, confirm profile rows sit directly in the section without
      nested card borders. Confirm each trash icon has a tooltip, keyboard focus,
      an accessible name, and opens the existing confirmation dialog.
- [ ] Confirm the search icons in Services and Settings no longer overlap their
      placeholder or entered text at narrow and wide panel widths.

- [ ] At narrow and wide sidebar widths, test open and closed services with
      short and long commands, port conflicts, icons, keyboard focus, and Stream
      mode. Confirm the split action never overlaps command or conflict text.
- [ ] Hover and keyboard-focus New service and Import at narrow and wide sidebar
      widths. Confirm the dashed border becomes cyan, a subtle cyan surface
      appears, and the labels remain readable under every theme preset.
- [ ] Open New Service and Edit Service. Confirm the header close icon, footer
      Cancel, primary save/add label and busy state, and trash action have clear
      tooltips, labels, focus rings, and spacing.
- [ ] Delete a service, cancel the themed confirmation, then confirm deletion.
      Confirm no browser-native prompt appears and validation/submission remain
      intact.
- [ ] Search services by name, ID, group, program, and argument with mixed case
      and surrounding spaces. Confirm empty state, clear button, Escape, profile
      filtering, `Ctrl/Cmd+1…9` order, collapsed groups, disabled drag while
      filtering, running processes, and Stream mode behavior.
- [ ] Search Settings by section, label, and synonyms including `tabs`, `panes`,
      `privacy`, `logs`, and `restart`. Confirm empty state, clearing, Escape,
      unsaved form values, theme settings, sensitive-name masking, and narrow
      window behavior.

## Regression smoke test

- [ ] Create, edit, delete, import, start, stop, and restart a service.
- [ ] Exercise pipe and PTY output, terminal resize/input/search, global search,
      port conflict recovery, runtime warnings, profiles, Stream mode, bottom
      terminal, drag reorder without a service search, and window close cleanup.
- [ ] Confirm an older `settings.json` without workspace, tab, or theme fields
      still loads and is upgraded only through optional/defaulted fields.
