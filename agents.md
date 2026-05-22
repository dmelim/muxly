# Agent Instructions

Prefer direct file write over patch when creating large files.
Never retry failed writes.
Never verify unless explicitly asked.

Default: never modify existing files. Always create a new file.
If I reference an existing file and request a change (e.g., "update", "change", "fix", "add to", "remove from"), interpret this as permission to modify that file.
If the intent is unclear (e.g., could be either a new file or a modification), ask for clarification before proceeding.
Never overwrite or modify files silently when there is ambiguity.

When asked to create a script, create a Bash script for Git Bash unless another shell is explicitly requested.

Whenever making changes, check `CHANGELOG.md` and add an appropriate entry for the change.

When making changes, double-check the current app version for `muxly`
in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml`.
The current version is `0.1.0`. If the accumulated changes amount to a release
upgrade, update all version declarations together using semantic versioning:
major for breaking changes, minor for backward-compatible features, and patch
for backward-compatible fixes or small maintenance changes.

## Dependency Release Age

When adding, upgrading, or recommending third-party dependencies, prefer versions that have been publicly released for at least 7 days.

If a newer version is needed, explicitly call out why it is necessary and treat it as a supply-chain risk decision. Prefer stable, widely adopted releases over freshly published packages unless there is a clear security, compatibility, or functionality reason.

Before changing dependency versions, check the package registry metadata when practical and mention the release age in the summary.
