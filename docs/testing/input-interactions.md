# Input interaction regression tests

Run this suite with native computer use against the current branch's Tauri app.
There are two parts: Windows and macOS. Matching IDs exercise the same behavior;
platform-specific inputs are deliberately written out. Do not substitute DOM
`dispatchEvent`, JavaScript `.click()`, or the Chromium component harness for a
native gesture. The component harness is supplementary evidence only.

## Setup and recording (both parts)

1. Record date, OS version, branch, commit, dirty working-tree state, app version,
   and native runtime (WebView2 on Windows; WKWebView on macOS). A commit alone
   does not identify uncommitted fixes. Keep a diff or its SHA-256 with the result.
2. Use the isolated identifier `com.diethos.muxly.interactiontest`; never run this
   fixture against the normal `com.diethos.muxly` configuration. Close any previous
   QA instance before resetting it. Do not stop personal services.
3. From the repository root, run `node docs/testing/prepare-interaction-fixture.mjs`.
   It creates 18 disposable, initially stopped services and two panels, with
   enough tabs/cards to expose both custom scrollbars. It refuses to overwrite a
   prior QA configuration. Archive a previous QA directory before a fresh run.
   No package installation is required when the existing dependencies are ready.
4. Launch the branch with
   `npm run tauri -- dev --no-watch --config docs/testing/tauri.interaction-test.json`.
   Confirm the window title is **Muxly Interaction QA**. Keep the dev process
   alive throughout the run. Do not test the installed release by mistake.
   The QA server uses port 1431, separate from the normal development port.
   If macOS computer use cannot attach to the unbundled executable, stop that
   QA process, run
   `npm run tauri -- build --debug --bundles app --config docs/testing/tauri.interaction-test.json`,
   and open `src-tauri/target/debug/bundle/macos/Muxly Interaction QA.app` through
   computer use. This packages the current frontend into native WKWebView and
   needs no dev server. Keep using the isolated identifier and record this mode.
5. QA configuration paths:
   - Windows: `%APPDATA%\com.diethos.muxly.interactiontest`.
   - macOS: `~/Library/Application Support/com.diethos.muxly.interactiontest`.
6. Start **QA 01** only when terminal output/search is required. It prints 120
   lines and then idles without opening a port. **QA 02** is the PTY equivalent.
   Leave other services stopped. Keep both custom scrollbars visible by narrowing
   their surfaces if necessary. Use only QA services for opening/closing panels.
7. Record a result for every ID and subcase: **PASS**, **FAIL**, **PARTIAL**,
   **BLOCKED**, or **NOT RUN**. Include exact inputs, actual result, and evidence.
   A failed input call is not a pass. A menu that appeared during a held button
   must still be present in an observation after release.
8. After each action group, inspect fresh accessibility state. Use screenshots
   for menu persistence, dimensions, scroll offsets, and focus rings. Derive
   coordinates from a fresh screenshot and refresh element indices after changes.
   Record the first failure before continuing; do not silently change the test.
   Use coordinate clicks for mouse-button-specific assertions: some native
   accessibility element clicks can invoke a default action rather than the
   requested mouse button. Check at the same coordinate with secondary and
   primary buttons before attributing a discrepancy to the app.
9. If the tool cannot hold/release modifiers and mouse buttons independently,
   mark that release-order subcase BLOCKED. A combined Control-click proves only
   the release sequence the tool actually implements. Likewise, do not claim a
   modifier-held drag was tested using an ordinary drag.

## Part 1 — Windows

Use the native Windows app. Ctrl is the application modifier; ordinary secondary
click is the right mouse button. Menu-key means the keyboard's Context Menu key.
When unavailable, use Shift+F10. Use Tab/Shift+Tab to move real keyboard focus;
hover alone is not focus.

### W01 — Opening release must not activate anything

For each target: **QA 01 card**, **Interaction QA group header**, **QA 01 tab**,
and **QA 01 terminal content**:
1. Record panels/tabs, selected service, group expansion, and process status.
2. Right-button down, hold briefly, release. Inspect after release and again after
   moving the pointer to a neutral area. The custom menu stays open.
3. Nothing opens, closes, starts, stops, moves, or collapses merely from release.
4. Dismiss with Escape. Repeat once with a normal quick right-click.
5. Ctrl+left-click is tested as an application shortcut in W05, not as a secondary click.

### W02 — Fresh activation and dismissal

Open each target's menu with right-click. On separate openings:
- Click a harmless action: service **Copy > Name**, group **Collapse/Expand**
  (restore the original state), tab **Reveal in Sidebar**, pane **Select all**
  (start QA 01 first). Exactly the selected action occurs and the menu closes.
- Press Escape. Only the menu closes; focus returns to its usable trigger.
- Click a neutral outside area. The menu closes; focus is not pulled back over
  the outside click. A subsequent ordinary click works.
- Open another target's menu while one is open. Only the new menu remains.

### W03 — Keyboard opening and navigation

Focus the service card, a button in the group header, and the terminal tab in
turn. Press Shift+F10; repeat using Menu-key if available. In terminal content,
press Shift+F10. Expect the appropriate custom menu. Navigate with Up/Down,
Home/End, open a submenu with Right, return with Left, then Escape. Disabled
items must not execute. Keyboard opening must not require an extra mouse click.

### W04 — Search fields and already-open menus own their events

Start QA 01, open its in-pane search, enter `searchable`.
- Right-click the search input: editing context menu, never the pane action menu.
- Focus that input and press Shift+F10/Menu-key: retain native field behavior;
  never replace it with the pane action menu. If this runtime has no native
  keyboard editing menu, record that fact rather than demanding one appear.
- Focus terminal content and press Shift+F10: pane action menu opens.
- While that menu owns focus, press Shift+F10 again. The pane must not rebuild or
  replace it. Escape closes the menu without also closing the search bar.
- Repeat mouse and keyboard ownership checks in QA 02's running PTY textarea.
  It must use the pane menu, unlike an ordinary editing field.
- Select terminal output using the pane menu's Select all. Right-click inside the
  selection: Copy must remain enabled. Escape must preserve the selection.

### W05 — Split button, card, and modifier shortcut

Use unopened QA 10, then QA 11 (close their tabs between repeats).
- Focus **Open … in a new panel** with Tab. Press Enter, then repeat with Space.
  Each gesture opens exactly one separate panel; no duplicate tab is first opened
  in the old panel. Space release must not trigger a second action.
- Focus the service card itself. Enter and Space each open it normally in the
  focused panel. Close the resulting QA tab between repeats.
- Ctrl+left-click a closed card: exactly one new panel. Plain left-click: normal
  opening in the focused panel. Recheck panel and tab counts after every step.

### W06 — Confirmation buttons and held keys

Use a reversible **Switch shell** confirmation in the bottom terminal. Start an
idle shell with no commands running, then select another available shell. If only
one exists, use **Open terminal** for another QA service's folder while the idle
bottom terminal is open. Do not use deletion of personal data to create a dialog.
- Tab to **Cancel**, press Enter: dialog closes, shell/session stays unchanged.
- Reopen, focus Cancel, press Space: same result.
- Reopen, focus **Switch shell** (or **Open terminal**), press Enter: exactly one
  transition occurs. Repeat with Space, switching back afterward.
- Reopen and send a repeated/held Enter sequence. It must not confirm repeatedly
  or consume the tail of the key hold that opened the dialog. If the tool cannot
  generate repeat events, mark this subcase BLOCKED.

### W07 — Resize handles reject secondary input

Test the left sidebar handle, right details-sidebar handle, and bottom-terminal
horizontal handle. Take before/after screenshots of their boundaries.
- Right-button press/move/release and middle-button press/move/release: no resize
  and no stuck resize cursor/selection suppression after release.
- Ordinary left-button drag about 40 px: correct dimension changes smoothly.
  Release and move again: resizing stops. Restore the original dimension.
- Ctrl+left drag remains a primary drag on Windows.

### W08 — Custom scrollbar input

Test both the service sidebar vertical scrollbar and overflowing tab strip's
horizontal scrollbar. Record the first visible card/tab and thumb position.
- Right-click and middle-click the track/thumb: no jump, drag, or tab activation.
- Left-click track outside thumb: scrolls once. Left-drag thumb: scroll follows,
  stops on release, and does not activate a tab/service. Restore the offset.
- Ctrl+left-click/drag retains primary-pointer behavior on Windows.

### W09 — Tab drag/click separation

Left-drag a QA tab to another position and then to the other panel. Each gesture
moves it once; release does not activate an unrelated tab or close button. Test a
sub-threshold movement as an ordinary click. Begin another drag and press Escape:
no move, stale indicator, or stuck capture. Right-click a tab afterward: menu stays.

### W10 — Cleanup and repeat

Repeat W01 on a card after all other cases. Stop QA 01/02, close the QA window
normally, and stop its dev server. Record final state and remaining limitations.
Retain the isolated config and test evidence for reproducibility; do not touch
normal Muxly data. Do not mark the macOS part passed based on Windows results.

## Part 2 — macOS

Use the native macOS app (WKWebView). **Control** is the secondary-click modifier;
**Command** is the application shortcut modifier. They are not interchangeable.
A two-finger trackpad click or right mouse button is an additional secondary-click
route. Use Tab/Shift+Tab and verify focus; if macOS keyboard navigation prevents
reaching a button, record the limitation rather than changing OS settings silently.
Send Shift+F10 as a function-key event (physical keyboards may need Fn+Shift+F10).

### M01 — Opening release must not activate anything

For each target: **QA 01 card**, **Interaction QA group header**, **QA 01 tab**,
and **QA 01 terminal content**:
1. Record panels/tabs, selected service, group expansion, and process status.
2. Hold Control, press left mouse, hold briefly, release mouse, then Control.
   Inspect after both releases and after moving to a neutral area. Menu stays open.
3. Repeat with Control released before the held mouse button. Record this subcase
   separately; never infer it from a combined Control-click API.
4. Nothing opens, closes, starts, stops, moves, or collapses merely from release.
5. Escape to dismiss. Repeat with quick Control-click and then right-click or
   two-finger secondary click. Every completed route leaves the menu open.

### M02 — Fresh activation and dismissal

Open each target's menu with Control+left-click. On separate openings:
- Click a harmless action: service **Copy > Name**, group **Collapse/Expand**
  (restore the original state), tab **Reveal in Sidebar**, pane **Select all**
  (start QA 01 first). Exactly the selected action occurs and the menu closes.
- Escape closes only the menu and restores focus to a usable trigger.
- An ordinary outside click dismisses it without pulling focus back over that
  click. A subsequent ordinary click works.
- Control-click another target while a menu is open. Only the new menu remains.

### M03 — Keyboard opening and navigation

Focus the service card, a group-header button, and terminal tab in turn; send
Shift+F10 (Fn+Shift+F10 if the physical keyboard requires it). Repeat in terminal
content. Expect the corresponding menu. Use Up/Down, Home/End, Right to enter a
submenu, Left to return, and Escape. Disabled items do not execute. No extra mouse
click should be needed. macOS has no standard Context Menu key requirement.

### M04 — Search fields and already-open menus own their events

Start QA 01, open its in-pane search, enter `searchable`.
- Control-click/right-click the search input: native editing menu, not pane actions.
- Focus the input and send Shift+F10. WKWebView may not open a native keyboard
  editing menu; either native behavior or no menu is acceptable, but the custom
  pane menu must not open and the text must stay intact.
- Focus terminal content and send Shift+F10: pane menu opens.
- Send Shift+F10 again while the menu has focus: no replacement/rebuild. Escape
  closes just that menu, leaving search open.
- Repeat ownership checks on QA 02's running PTY hidden textarea. It must use
  the pane menu, unlike the search input.
- Select output with the pane menu's Select all, then right-click within the
  selection: Copy must remain enabled. Escape, then Control-click within the
  same selection: Copy must still be enabled. Record the two routes separately.

### M05 — Split button, card, and modifier shortcut

Use unopened QA 10, then QA 11, closing their tabs between repeats.
- Tab to **Open … in a new panel**. Enter and, on a fresh opening, Space each
  create exactly one separate panel, with no duplicate in the old panel. Observe
  after Space release as well.
- Focus the card itself: Enter/Space open normally in the focused panel.
- Command+left-click a closed card: exactly one separate panel. Plain left-click:
  normal opening. Control+left-click: context menu, no panel/tab change.
  Record panel and tab counts after each action.

### M06 — Confirmation buttons and held keys

Use the reversible **Switch shell** dialog in an idle bottom terminal. Choose
another shell; if unavailable, request **Open terminal** for another QA service
while the idle bottom terminal is open. Never interrupt a personal shell session.
- Tab to Cancel, press Return: dialog closes without switching/restarting the shell.
- Reopen and use Space on Cancel: same result.
- Reopen, focus Switch shell/Open terminal, press Return: exactly one transition.
  Repeat using Space and restore the original shell.
- Reopen and test held/repeated Return. It must not repeatedly confirm or consume
  the tail of the opening key hold. Record a tool limitation if repeat events
  cannot be generated; a single press is not equivalent.

### M07 — Resize handles reject secondary input

For left sidebar, right details sidebar, and bottom-terminal resize handles:
- Take screenshots before and after Control+left press/move/release; no resize,
  stuck cursor, or selection lock. Repeat with right and middle mouse buttons.
- Ordinary left-drag about 40 px: the intended dimension changes; release stops
  resizing. Restore the original dimensions.
- Do not substitute Command for Control in the rejection test. If only atomic
  Control-click is supported, test that and mark the held-movement case BLOCKED.

### M08 — Custom scrollbar input

For the sidebar vertical scrollbar and overflowing tab-strip horizontal scrollbar:
- Record thumb position and first visible card/tab. Control-click track and thumb,
  then test Control-held drag if supported: no jump, drag, or activation.
- Repeat with right and middle clicks. They must not scroll or activate content.
- Ordinary left-click outside the thumb scrolls; left-drag scrolls smoothly and
  stops on release without activating content. Restore each starting offset.

### M09 — Tab drag/click separation

Left-drag a QA tab within its panel, then across panels. Each moves once with no
extra action on release. Sub-threshold movement remains a click. Start another
move and press Escape: no move, stale insertion marker, or stuck capture.
Control-click the tab afterward: menu stays and no drag starts. Use real native
pointer input; WKWebView behavior cannot be proven by a Chromium-only test.

### M10 — Cleanup and repeat

Repeat M01 on a service card. Stop QA 01/02, quit the QA window normally, and stop
its dev server. Preserve isolated configuration and evidence, and record any
remaining subcases. Do not mark the Windows part passed based on macOS results.

## Result template

Store a dated result beside this procedure (for example
`input-interactions-macos-YYYY-MM-DD.md`). Include:

- Environment/build identification, fixture path, native input tool and limitations.
- A row for every platform ID and individual failed/blocked subcase.
- Expected versus actual behavior, screenshots or relevant accessibility excerpts.
- Failures with exact reproduction steps; do not convert a failed run into a pass
  after a code change without recording the change and rerunning affected cases.
- Cleanup performed and any QA process/window/config intentionally left available.
- Explicit NOT RUN for the other platform.
