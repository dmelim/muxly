# Agent Instructions

Prefer direct file write over patch when creating large files.
Never retry failed writes.
Never verify unless explicitly asked.

Default: never modify existing files. Always create a new file.
If I reference an existing file and request a change (e.g., "update", "change", "fix", "add to", "remove from"), interpret this as permission to modify that file.
If the intent is unclear (e.g., could be either a new file or a modification), ask for clarification before proceeding.
Never overwrite or modify files silently when there is ambiguity.

When adding a new Markdown or documentation-adjacent file under `docs/`, confirm
whether it should be committed to the repository or kept local/untracked before
creating or linking it.

When making visual or frontend changes, read `docs/design.md` first and keep
the implementation aligned with the design system.

When asked to create a script, create a Bash script for Git Bash unless another shell is explicitly requested.

## Versioning and the changelog

Routine work goes under `## [Unreleased]` in `CHANGELOG.md`. Classify every
entry under the right header so the eventual release bump is unambiguous:

- `### Added` — new feature or capability → contributes to **MINOR**
- `### Changed` — modification to existing behaviour or appearance →
  **MINOR** (or a breaking-class bump — see below)
- `### Fixed` — bug fix or correction → contributes to **PATCH**

**Do not touch the version number on routine changes.** The version lives in
three files that must always move together — `package.json`,
`src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` — and is bumped only when
cutting a release. End every task summary by noting the contribution type
(e.g. *"logged under `### Fixed` — patch-level"*) so the human can decide
when to cut a release.

### Inferring the release bump

When asked to release (or to "bump the version", "publish", "tag a release"),
read `[Unreleased]` and pick the bump from its contents, then follow
`docs/releases.md` start to finish:

- **PATCH** (`0.2.0` → `0.2.1`) — only `### Fixed` entries since the last
  release.
- **MINOR** (`0.2.x` → `0.3.0`) — any `### Added`, or `### Changed` items
  that change behaviour or appearance.
- **MAJOR** (`1.0.0` and beyond) — at `0.x`, breaking changes to the
  `services.json` schema or established UX **still bump MINOR**: the `0.x`
  prefix already signals "not yet stable." Bumping to `1.0.0` is a deliberate
  stability commitment — do it **only when explicitly asked**, never as a
  reflex to a breaking change. After `1.0`, any breaking change bumps MAJOR.

If `[Unreleased]` is empty, there is nothing to release — say so rather than
inventing a bump.

## Dependency Release Age

When adding, upgrading, or recommending third-party dependencies, prefer versions that have been publicly released for at least 7 days.

If a newer version is needed, explicitly call out why it is necessary and treat it as a supply-chain risk decision. Prefer stable, widely adopted releases over freshly published packages unless there is a clear security, compatibility, or functionality reason.

Before changing dependency versions, check the package registry metadata when practical and mention the release age in the summary.
