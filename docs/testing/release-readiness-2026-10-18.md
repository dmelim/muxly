# 0.6.2 release-candidate checks — 2026-10-18

The tested macOS candidate builds and launches, with no failures in the checks
completed below. This is targeted validation, not full release sign-off.

## Build identification

- Branch: `release/0.6.2`.
- Commit: `080d1fee6e054056afc4571a6a47ba856f0ca5c8`.
- Working tree clean throughout testing; this report is the only added file.
- Configured version: **0.6.1**, intentionally awaiting the release bump.
- macOS 26.6.2 (25G83), Apple Silicon arm64, native WKWebView.
- Node 26.4.0; Cargo 1.96.0. README recommends Node 24 LTS; that version was not tested.
- Existing dependencies and lockfiles used; no dependencies installed or changed.
- Existing disposable fixture reused under `com.diethos.muxly.interactiontest`.
  No personal services or normal app configuration were used.

## Automated and build results

| Check | Result |
| --- | --- |
| `npm run build` | PASS: TypeScript and Vite production build |
| `node --test tests/*.test.mjs stream-privacy.test.mjs` | PASS: 37 tests |
| `cargo test --locked --lib` | PASS: 61 tests with local socket access |
| `tests/browser-interactions.mjs` with bundled Playwright | PASS: all seven reported interaction groups |
| Debug native app bundle with QA config | PASS: built, signed ad hoc, launched |
| Optimized native app bundle with QA config | PASS: built, signed ad hoc, launched |
| Production `codesign --verify --deep --strict` | PASS |
| Production architecture | arm64 |

The initial sandboxed Rust run had three socket-related failures (permission
denied / no free port). All passed when rerun with local socket access. The build
reported a large JavaScript chunk warning and a Node deprecation warning; neither
prevented completion. Notarization was skipped because credentials were absent.

Native bundles were built with:

```sh
npm run tauri -- build --debug --bundles app --config docs/testing/tauri.interaction-test.json
npm run tauri -- build --bundles app --config docs/testing/tauri.interaction-test.json
```

## Native observations

Inputs used the native computer-use API. Screenshots and fresh accessibility
snapshots were inspected; no DOM event injection was used.

| Check | Result and evidence |
| --- | --- |
| Debug startup | PASS: window loaded 18 fixture services and persisted panels |
| Pipe service | PASS: QA 01 started, rendered lines through 120, stopped normally |
| PTY service | PASS: QA 02 started and rendered lines through 120 |
| Control-click terminal menu | PASS: combined Control-click held 500 ms left menu open after release |
| Selection preservation | PASS: Select all, then Control-click inside output left Copy enabled |
| Keyboard menu | PASS: Shift+F10 in PTY opened custom menu; repeating kept it open; one Escape dismissed and restored terminal input focus |
| PTY Ctrl+C | PASS: foreground Node exited with recorded SIGINT and no PID; Failed status reflected this deliberate signal exit |
| Pipe search | PASS: `searchable` returned 125 matches including command/banner text |
| Search event ownership | PASS: Shift+F10 in search did not open pane actions; native suggestion UI appeared |
| Group focus restoration | PASS: Tab from service search to Reorder Interaction QA, Shift+F10, Escape returned focus to the initiating button |
| Optimized startup | PASS: debug instance quit; optimized bundle opened and loaded fixture |
| Optimized PTY start/stop/restart | PASS: fresh PID on second run; normal Stop removed PID and showed Stopped |
| PTY retained scrollback | PASS: after two runs, `QA searchable line` returned 243 matches (240 output lines plus command/banner matches); screenshot showed the first run's PID and output retained |
| Narrow search layout | PASS for current two-panel layout: search replaced toolbar on one row, with count and controls visible |

## Coverage and remaining release work

This run partially covers M01–M04 and M10 in `input-interactions.md`. M05–M09
(split activation, confirmation, resize, scrollbar and drag suites) were NOT RUN
natively in this session. Independent modifier/button release ordering and held
drag/repeat cases remain BLOCKED by native input API limitations. W01–W10 were
NOT RUN: no Windows/WebView2 testing was performed. Chromium results do not
establish Windows native behavior, particularly the latest keyboard-menu fix.

The rest of `manual-test.md` was NOT RUN, including full stream-mode, profile,
Git, import, editor and configuration workflows. The prior dated report is
historical evidence, not a claim that those checks passed on this commit.

Before public release: complete applicable remaining platform/manual checks,
bump application/installer versions to 0.6.2 consistently, update the dated
changelog, and validate the final distributable under the intended signing and
notarization policy. This run built QA `.app` bundles, not a final DMG/Windows
installer, and did not publish or tag a release.

## Cleanup

All QA services are stopped. Debug app quit. Optimized **Muxly Interaction QA**
is intentionally left open for inspection, with the isolated fixture retained.
Normal Muxly configuration and services were untouched.

## Subsequent version preparation

After the checks above, application and installer metadata were bumped to 0.6.2
and the changelog was dated 2026-10-18. The observations above remain evidence
for the pre-bump commit; this metadata change does not complete the outstanding
manual/platform or final distributable checks.
