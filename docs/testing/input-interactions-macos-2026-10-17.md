# Native macOS input test results — 2026-10-17

**Outcome: both failures found in the initial run are now fixed and retested.**
See the follow-up below for the tested fixes. The original menu-dismissal symptom
was not reproduced with the supported Control-click or right-click gestures.
Some held-input subcases remain blocked by the computer-use API. Windows was
**NOT RUN**; this report makes no claim about WebView2.

## Initial tested build and environment

- Branch: `release/0.6.2`.
- Base commit: `cbb77289e50ada78b1f391dda971453b4f66cce9`.
- Working tree: uncommitted input-interaction fixes from the preceding work;
  no application source was changed during this native run.
- App version: `0.6.1` (the branch's configured version).
- macOS: `26.6.2`, build `25G83`; native Tauri/WKWebView.
- Build: `npm run tauri -- build --debug --bundles app --config docs/testing/tauri.interaction-test.json`.
  Production frontend assets were embedded in a debug native bundle, launched
  through computer use as **Muxly Interaction QA**. This was not Chromium.
- Identifier: `com.diethos.muxly.interactiontest`.
- Fixture: `~/Library/Application Support/com.diethos.muxly.interactiontest`;
  18 services, two initial panels, 9 initial tabs. Only QA 01 and QA 02 were run.
- Source-tree SHA-256: `bda8bcf17eb47248817a13895423ef632a9c93c07fed22ccd4e8b7df5e58305c`.
  To reproduce the digest, sort all files recursively beneath `src`, then feed
  each relative POSIX path, a NUL byte, its bytes, and a NUL byte into SHA-256.
  This includes the new untracked helper files, unlike a plain `git diff` digest.
- Tool: `mcp__cua_repl`, native app click/key/scroll/drag APIs. Assertions used
  fresh accessibility snapshots and native screenshots after input.
- Startup notes: normal dev port 1421 was occupied, so the QA override uses 1431.
  Computer use could not attach to the unbundled dev binary; that QA process was
  stopped and replaced with the packaged app. The unrelated dev instance was
  left alone.

## Initial results by test ID

| ID | Status | Observed result / limitation |
| --- | --- | --- |
| M01 | PARTIAL | Held combined Control-click (500 ms), quick Control-click, and right-click left the custom menu open on service, group, tab, and terminal. No unintended panel, process, or collapse action. Independent Control-before-mouse release is BLOCKED; the API exposes combined clicks, not independent button-up/key-up. Two-finger hardware input was not available. |
| M02 | FAIL | Copy > Name, group Collapse, tab Reveal in Sidebar, and pane Select all executed on a fresh click and closed the menu. Copied name was verified by pasting into service search. Selection was verified visually. Outside clicks returned focus to the clicked search input for all four targets. Opening a card menu replaced an existing tab menu. Escape restored card/tab/terminal focus, but group focus was lost to the page (F1 below). |
| M03 | PASS | Shift+F10 opened card, group, tab, and terminal menus. Up/Down, Home/End, Right/Left submenu navigation worked. Navigation skipped disabled Restart; no disabled action executed. The group was reached by Tab from service search, not by assuming a mouse click focused it. |
| M04 | FAIL | Search Control-click opened the native editing menu; Shift+F10 in that input did not open pane actions or change its text. Shift+F10 in terminal content opened the pane menu, repeating it left the same menu intact, and Escape left search open. The running QA 02 PTY used the custom pane menu, including enabled Paste. However, Control-click cleared selected output and disabled Copy; right-click preserved it (F2 below). |
| M05 | PASS | Return and Space on the nested split button each created one new panel for QA 10, without a duplicate in the old panel. Return/Space on the card opened a normal tab in the existing panel. Command-click QA 11 created one separate panel; plain click opened a normal tab. Control-click opened the menu without opening a panel. Extra test tabs/panels were closed between cases. |
| M06 | PARTIAL | In an idle bottom terminal, Return and Space on Cancel both cancelled Switch shell and preserved Default shell. Return on the affirmative button selected Bash; Space on the affirmative button restored Default shell. Each produced one visible transition. Held/repeated-key event generation is BLOCKED: a timed key press does not establish that native repeat events were delivered. |
| M07 | PARTIAL | Coordinate Control/right/middle clicks on all three handles left dimensions unchanged. Ordinary left drags moved left boundary 600→680 px, right boundary 1880→1800 px, and bottom divider 960→880 px in the captured image; each was restored afterward. No subsequent pointer action continued resizing. Modifier/secondary-button movement while held is BLOCKED by the drag API. |
| M08 | PARTIAL | Coordinate Control/right/middle clicks left both custom scrollbar values unchanged. Primary horizontal track click changed 0→746; thumb drag changed 746→402; Home restored 0. Primary vertical track click changed 537→60; thumb drag changed 60→295; Home restored 0. No tab/service activated. Control-held dragging is BLOCKED. An accessibility-index middle-click discrepancy was excluded after coordinate retesting; see tool notes. |
| M09 | PARTIAL | Native drag moved QA 02 before QA 01, then into the QA 09 panel exactly once. QA 01 kept running. A 2 px movement selected QA 09 without moving a tab. Control-click on the moved QA 02 tab opened a persistent menu. Escape during a held drag is BLOCKED because `drag()` is atomic. |
| M10 | PASS | Repeated the original 500 ms Control-click on QA 01 after other tests: menu remained open. QA 01 and QA 02 were stopped, the idle bottom shell was closed, and the QA app was quit. Isolated config retained for reproduction; normal Muxly data was not used. |
| W01–W10 | NOT RUN | Windows native environment was not exercised. |

## F1 — Escape from the group menu loses keyboard focus

1. Click service search, Tab to the Services scroll container, then Tab to the
   first group-header control (Reorder Interaction QA).
2. Press Shift+F10. The group menu opens with Start All selected.
3. Press Escape.

Expected: focus returns to the group control that opened the menu, so keyboard
navigation can continue there.

Actual: the menu disappears and the accessibility snapshot reports:

```text
The focused UI element is ... HTML content Description: Muxly, URL: tauri://localhost
```

The same Escape path for a service card reported the QA 01 button; the tab path
returned to its tab. This failure was retained in the report rather than repaired
mid-run. A likely cause is restoring focus to the non-focusable group wrapper,
but that is code-level inference, separate from the observed failure.

## F2 — Control-click clears terminal selection before opening Copy

1. Start QA 01 and open its terminal menu.
2. Click Select all. A screenshot shows selected log output across the terminal.
3. Right-click within the selected output. The pane menu has **Copy enabled**.
4. Escape to dismiss, then Control-click within the same selected output.

Expected: the selected output remains selected and Copy stays enabled through
both macOS secondary-click routes.

Actual: the Control-click menu remains open, but Copy is disabled. The observed
menu diff was:

```text
~ (disabled) Copy
The focused UI element is ... (selected) Open terminal
```

This was reproduced with a screenshot-derived coordinate inside selected text,
not only an accessibility-index click. Repeating Select all visibly reselected
the text; ordinary right-click again preserved an enabled Copy item. This is a
selection-loss issue, distinct from the original immediate menu dismissal.

## Follow-up — F1 and F2 fixed and retested

The same native QA app was rebuilt on `release/0.6.2` after commit `c6679c2`,
with the application fixes in the working tree. This section supersedes the
initial F1/F2 failures; the initial observations above remain as reproduction
evidence. The environment, fixture, and build command were unchanged.

Source-tree SHA-256: `b6933faff259a7780a436c0e43c0464ba6e704e0281a83ff8b3e808c46a1e291`.
For this digest, paths are repository-relative, including the `src/` prefix;
sort the files and hash each path, NUL, file bytes, NUL.

| Finding / regression | Result | Native observation |
| --- | --- | --- |
| F1 / M02 group focus | PASS | From service search, Tab to Reorder Interaction QA, then Shift+F10 and Escape restored focus to Reorder. Repeated from Collapse and Pin project; Escape restored each exact initiating button. |
| F2 / M04 read-only log selection | PASS | Start QA 01, Select all, right-click inside selected output: Copy enabled. Escape, then Control-click at the same coordinate held for 500 ms: menu remained open after release and Copy remained enabled. |
| F2 / M04 interactive PTY selection | PASS | Start QA 02, Select all, then 500 ms Control-click inside selected output: menu remained open, Copy and Paste both enabled. |
| Ordinary primary click | PASS | After dismissing the log menu, an ordinary click cleared the selection; reopening with Control-click correctly showed Copy disabled. |
| Cleanup | PASS | Both fixture services stopped and the isolated QA app quit. |

Implementation: group menus retain the actual initiating control for focus
restoration, and keyboard invocation opens the menu directly. The group wrapper
is programmatically focusable as a fallback. On macOS, the terminal capture
handler stops Control-primary mousedown before xterm can clear its selection,
while preserving the native context-menu default action and interactive focus.

Additional checks: all 25 Node tests passed; TypeScript/Vite and native app build
passed. The component browser regression runner also passed, including group
keyboard and pointer focus restoration, nested split-button activation,
Cancel/Confirm, opening-release suppression, and menu ownership. These component
checks supplement the native run; they are not Windows/WebView2 evidence.

Windows and the unsupported held-input subcases remain untested/blocked as
recorded above. No full-suite rerun is claimed for this targeted follow-up.

## Tool limitations and interpretation

- Native gestures were performed through computer use, not injected DOM events.
- `click({ key: 'ctrl', durationMs: 500 })` holds Control across one complete click.
  It cannot prove Control-release-before-mouse-release behavior.
- `drag(from, to)` accepts no modifier/button argument and exposes no intermediate
  key action. Modifier-held drags, secondary-button drags, and Escape mid-drag
  therefore remain explicitly blocked.
- `pressKey` has a hold duration but no documented repeat-event guarantee. A
  single successful Return is not evidence for repeat suppression.
- On the horizontal scrollbar, an **element-index** middle click changed the
  value 0→437 twice. At the same visual area, **coordinate** middle clicks left
  the value at 0; coordinate primary clicks changed it as expected. This was
  treated as an input-tool/accessibility-action discrepancy, not a confirmed
  product bug. The procedure now calls for coordinate input in button-specific
  assertions.
- Screenshots were inspected in the computer-use transcript. This report stores
  the relevant observations and accessibility excerpts; no screenshot binaries
  or machine-specific generated service configuration are committed.
- The initial run left source unchanged and recorded F1/F2 against its digest.
  The follow-up above rebuilt and verified their fixes against a new digest.
