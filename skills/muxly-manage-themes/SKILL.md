---
name: muxly-manage-themes
description: Create, inspect, apply, repair, import, or export Muxly semantic colour themes while preserving unrelated settings and validating the palette. Use when a user asks to manage a Muxly theme or its theme settings.
---

# Muxly Theme Manager

Manage Muxly themes through the product's semantic token model. This repository copy is the canonical skill source. Read `../../docs/design.md`, `../../src/theme.ts`, and `../../src-tauri/src/settings.rs` when the schema or fallback behavior is unclear.

## Choose the operation

- For a one-off user theme, edit the runtime `settings.json` only after the user asks to apply or change it.
- For a built-in preset or semantic token change, update the product source and keep the frontend and Rust schemas compatible.
- For inspection, preview, comparison, or export, do not mutate the user's settings.

Prefer Muxly's Settings UI when it is available because it previews changes, validates hex values, warns about contrast, and can restore the saved palette. Direct file editing is useful for agent-driven import, export, and repair.

## Runtime settings

Locate `settings.json` in the OS app-config directory for `com.diethos.muxly`:

- Windows: `%APPDATA%/com.diethos.muxly/settings.json`
- macOS: `~/Library/Application Support/com.diethos.muxly/settings.json`
- Linux: `${XDG_CONFIG_HOME:-~/.config}/com.diethos.muxly/settings.json`

Before writing:

1. Read the complete JSON object and preserve every unrelated field.
2. Resolve the requested palette against `MuxlyTheme` in `src/theme.ts`. Accept only known semantic keys and six-digit hexadecimal colours.
3. Set `themePreset` to `custom` when applying overrides. Built-in preset ids are `default`, `midnight`, and `high-contrast`.
4. Check primary text against its relevant surfaces using the WCAG 4.5:1 target. Explain any intentional exception before applying it.
5. Write valid UTF-8 JSON atomically and read it back. Never construct JSON through string concatenation.

Ask immediately before the write if the current request did not already authorize changing the live Muxly configuration. External settings changes may require reopening Settings or restarting Muxly before they appear.

## Product themes

Presets and defaults live in `src/theme.ts`. Backend validation and persistence live in `src-tauri/src/settings.rs`; the visual contract lives in `docs/design.md`.

- Keep existing `settings.json` files loadable. New fields must be optional in TypeScript and use serde defaults in Rust.
- When adding a semantic key, update the TypeScript type, defaults, preset resolution, CSS variable mapping, Rust allowlist or sanitization, Settings editor, and design documentation together.
- Keep partial overrides valid. Missing or invalid values must fall back to the selected preset.
- Preserve Muxly's dark, cyan-accented baseline unless the user explicitly requests a different built-in direction.
- Do not add a theme dependency for palette editing. Muxly's semantic model already provides the required contract.

Report which preset or overrides changed, the settings path or source files affected, contrast concerns, and whether Muxly must refresh or restart.
