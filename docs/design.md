# Muxly — Design System

The visual language for Muxly: a dark, focused desktop command center for
development processes. This document is the source of truth for colour,
typography, spacing, and components. The app is built with React, Tailwind CSS
v4, and xterm.js.

## Brand

**Muxly** — a layered waveform "M" mark. Three stacked, rounded waveforms: the
top stroke white, the lower two in the brand cyan. The mark sits on a dark
navy rounded square. The waveform reads both as an "M" and as terminal/stream
activity — many processes multiplexed onto one surface.

The accent colour is taken from the cyan strokes of the logo. **Cyan is the
brand accent — never green.**

## Colour

The palette is dark-first (`color-scheme: dark`). Backgrounds are near-black
navy; surfaces are one step lighter; structure comes from low-opacity white
borders rather than hard lines.

### Surfaces

| Token            | Value       | Use                                            |
|------------------|-------------|------------------------------------------------|
| `bg/app`         | `#101215`   | App background, terminal background            |
| `bg/surface`     | `#15181d`   | Sidebars, detail inspector, panels             |
| `bg/elevated`    | `#18181b`   | Tooltips, popovers (`zinc-900`)                |
| `border`         | `white/10`  | All dividers and outlines                      |
| `hover/subtle`   | `white/5`   | Row / card hover                               |
| `hover/strong`   | `white/10`  | Active row, icon-button hover                  |

### Text

| Token            | Value              | Use                                     |
|------------------|--------------------|-----------------------------------------|
| `text/primary`   | `zinc-100` `#f4f4f5` | Headings, focused content              |
| `text/secondary` | `zinc-300` `#d4d4d8` | Body, default control text             |
| `text/muted`     | `zinc-500` `#71717a` | Labels, metadata, captions             |

### Accent — Cyan

The brand accent. Used for the primary action, focus rings, selection, the
running state, and any "active / live" emphasis.

| Token            | Value              | Use                                     |
|------------------|--------------------|-----------------------------------------|
| `accent`         | `cyan-400` `#22d3ee` | Primary accent — dots, rings, hover    |
| `accent/strong`  | `cyan-500` `#06b6d4` | Solid primary-button fill              |
| `accent/soft`    | `cyan-300` `#67e8f9` | Hover-lightened text/icon              |
| `accent/contrast`| `cyan-950` `#083344` | Text on a solid accent fill            |

Opacity variants in use: `accent/40` (focus rings), `accent/30` (focused-pane
ring), `accent/15` (badge fills, icon-button hover), `accent/50`–`/60`
(divider hover).

### Status

Process state is shown as a 2–2.5px filled dot. Each state has a distinct hue.

| State      | Token        | Value     |
|------------|--------------|-----------|
| Stopped    | `zinc-600`   | `#52525b` |
| Starting   | `amber-400`  | `#fbbf24` |
| Running    | `cyan-400`   | `#22d3ee` |
| Stopping   | `orange-400` | `#fb923c` |
| Exited     | `sky-400`    | `#38bdf8` |
| Failed     | `rose-400`   | `#fb7185` |

### Semantic

| Role     | Value                | Use                                     |
|----------|----------------------|-----------------------------------------|
| Warning  | `amber-500` `#f59e0b`| Restart action, attention states        |
| Danger   | `rose-500` `#f43f5e` | Destructive actions (delete)            |
| Info     | `sky-400` `#38bdf8`  | Clean-exit state                        |

### Terminal theme (xterm.js)

| Slot         | Value     |
|--------------|-----------|
| Background   | `#101215` |
| Foreground   | `#d4d4d8` |
| Cursor       | `#22d3ee` (accent) |
| Selection    | `#3f3f46` |

Muxly's own terminal chrome, including the pane header and `[manager]`
lifecycle notes, uses the terminal's semantic ANSI cyan slot. The complete
xterm ANSI palette is derived from the resolved status, feedback, text, and
accent tokens, so existing indexed terminal cells update when the theme
changes. Failures remain red and auto-restart notices remain yellow through
those resolved tokens.

## Typography

| Role      | Stack                                                          |
|-----------|----------------------------------------------------------------|
| UI        | `Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif` |
| Monospace | `"JetBrains Mono", "Cascadia Mono", Consolas, monospace`       |

Monospace is used for terminals, commands, paths, ports, and any literal
config value. Common sizes: `text-[10px]`–`text-[11px]` (labels/badges),
`text-xs` (metadata, captions), `text-sm` (body, controls), `text-base`
(panel headings), `text-xl` (the workspace title).

Label/eyebrow text uses uppercase with wide tracking
(`uppercase tracking-[0.14em]`–`tracking-[0.18em]`, `zinc-500`).

Details inspector field labels use sentence case in the UI font, normal tracking,
medium weight, and `text-xs text-zinc-400` for a softer, readable appearance.
Section headings such as Run history use `text-sm font-semibold text-zinc-100`
with `pt-4` spacing, clearly above the field labels in hierarchy without a divider.

## Layout

A fixed-height, three-column shell — the document itself never scrolls
(`overflow: hidden` on `html`, `body`, and the app shell); each region
scrolls independently.

```
┌───────────┬──────────────────────────┬───────────────┐
│ Services  │  Terminal panes          │  Details      │
│ sidebar   │  (resizable split view)  │  inspector    │
│ 220–560px │  flexible, ≥15% per pane │  260–600px    │
└───────────┴──────────────────────────┴───────────────┘
```

Both sidebars are collapsible and drag-resizable. Terminal panes are split
horizontally with draggable dividers. Minimum window size is 1024×680.

Spacing follows Tailwind's 4px scale. Common rhythm: `p-3` (panes, cards),
`px-5 py-4` (panel headers), `gap-2`/`gap-3` (control clusters).

## Shape & elevation

- **Radius** — `rounded-md` (6px) is the default for buttons, cards, inputs,
  tooltips, and badges. Status dots and avatars are `rounded-full`.
- **Borders** — 1px `white/10`. Selected/active items use a 2px left accent
  border instead of a fill where possible.
- **Elevation** — the UI is mostly flat. Only floating layers (tooltips) carry
  a shadow (`shadow-lg`). No shadows on buttons or cards.

## Components

### Buttons

One shared `Button` component. Variants:

| Variant       | Appearance                              | Use                       |
|---------------|-----------------------------------------|---------------------------|
| `primary`     | cyan-500 fill, cyan-950 text            | Main action (Start)       |
| `secondary`   | `white/10` fill                         | Neutral actions           |
| `ghost`       | transparent, `white/10` on hover        | Low-emphasis / toggles    |
| `warning`     | amber-500 fill, amber-950 text          | Restart                   |
| `destructive` | rose tint                               | Delete                    |
| `dashed`      | dashed `white/15` outline, cyan border and soft fill on hover | Additive (New, Import) |
| `link`        | text-only, underline on hover           | Cancel / dismiss          |

Sizes: `xs`, `sm`, `md`, `icon` (square `size-7`, pair with a sized icon).
Focus is always visible: `ring-2 ring-cyan-400/40`.

### Tooltips

Form checkboxes use the shared `Checkbox` component: dark surface, cyan checked
state, SVG checkmark, and a visible keyboard focus ring. Number inputs retain
native validation and keyboard stepping but hide browser spinner arrows.
Textareas scroll within their defined height without native resize handles.

Custom hover tooltip (`Tooltip`). The bubble renders through a **portal to
`document.body`** with `position: fixed`, so it is never clipped by a panel's
`overflow: hidden`; its horizontal position is clamped to the viewport.
`#18181b` fill, `white/10` border, 300ms show delay. Do **not** also set a
native `title` attribute on the same element — that produces a second,
duplicate tooltip.

### Cards (service list)

A card per service. Plain click opens it as the sole pane; `Ctrl/Cmd`-click
(or the hover split icon) opens it in an additional pane. State: a 2px left
border — accent when selected, `accent/40` when open elsewhere, transparent
otherwise. The status dot and name lead; the command shows in muted monospace.
Project group headers carry the pin action. Pinned projects form a stable group
at the top of the sidebar while service order inside each project is unchanged.
Dragging a service card into the terminal workspace opens it as a tab in the
hovered panel; an empty workspace accepts the same gesture and creates its first
panel. The destination uses a dashed cyan outline and a short drop label.

### Panels & dividers

The left sidebar has two inset panels with `p-2` outer spacing and `gap-2`:
a fixed controls/filter panel and a separately scrolling service-list panel.
The service-list panel keeps a Services heading above its scrolling content.
Both use transparent backgrounds and one-pixel neutral borders, letting the
darker app background show through as well as around and between them.
The central toolbar is also an inset transparent panel with a neutral outline
and `mx-2 my-2` spacing; it has no separate full-width divider beneath it.
The Details sidebar uses a transparent inset panel with `m-2` and a neutral
outline. Its header groups the editor, folder, browser, and Edit icon actions
beside the title without a separator below it.

Terminal panes are clipping boxes (`overflow: hidden`) — xterm owns its own
scrolling. Drag dividers are a 1.5px hairline (`white/10`) that lights to
`accent/50`–`/60` on hover.

Workspace panels and tabs are separate levels. A panel is one grid cell in the
terminal layout and owns an ordered tab strip. Only its active tab is visible,
but inactive terminals remain mounted. Tab-mode terminal controls float inside
the panel's top-right corner on a 10%-opaque surface background with a 2px
backdrop blur, rounded corners, and `p-1` padding, with no outer border. Bright
neutral icons and stronger cyan/amber accents stay readable over terminal output.
Tabs occupy the full row width with a custom
square, arrowless scrollbar revealed on hover or keyboard focus on Windows and macOS.
The 5px accent-coloured scrollbar overlays the inside of the terminal panel just below the tab-row border, without reserving space between tabs and terminal.
Tabs use a compact fixed width and truncate
long labels; the active tab scrolls into view. A normal service click opens a tab in
the focused panel; `Ctrl/Cmd`-click creates another panel with its own tabs.
Tabs can be reordered within a panel or dragged to another panel; an insertion
preview shaped like a muted copy of the dragged tab shows the exact drop
position in destination panels without duplicating the tab in its source panel,
and an emptied source panel is removed.
The service workspace below each tab strip has a one-pixel inset outline using
the neutral border token when unfocused and the soft cyan accent when focused.
The outline does not wrap or extend beside the tabs.

The bottom shell drawer is inset with `mx-2 mb-2`, a neutral one-pixel border,
and a soft cyan focus border, matching the service terminal cards. Its header
uses the shared Dropdown for installed shell profiles. Switching profiles ends
the current session through an in-app confirmation; the choice survives drawer
close/reopen for the current app session.

### Scrollbars

Thin, dark, custom (`scrollbar-width: thin`, 10px webkit fallback). Track
transparent; thumb `white/14`, `white/28` on hover. No arrow buttons. xterm's
horizontal scrollbar is hidden — terminal output wraps.

### Stream mode

Stream mode is an in-place audience filter, not a separate workspace. The
normal service layout, status, controls, logs, and bottom shell stay visible so
the operator can continue working while sharing the Muxly window.

Each terminal keeps its raw xterm instance mounted for ANSI parsing, cursor
movement, process state, and scrollback. Before paint, Stream mode hides that raw
surface and shows a selectable plain-text mirror built from xterm's parsed
buffer. The mirror masks absolute and home-relative paths, email addresses,
external URLs, and configured sensitive identities. PTY mirrors forward
keyboard and paste input to the existing process. Turning Stream mode off
reveals the untouched terminal again without restarting or replaying it.
The mirror inherits the workspace panel boundary and does not draw a second
inner border or rounded card inside the terminal.

Sensitive service and project labels must fail closed while aliases load. Use a
generic private label rather than briefly displaying the real identity.

## Motion

Motion is minimal and fast. Colour/opacity transitions ~100–150ms. Tooltips
fade after a 300ms intent delay. No large or decorative animation.

## Accessibility

- Every icon-only control has an `aria-label`.
- Focus is always visible (cyan focus ring); never removed without a
  replacement.
- Status is encoded by both colour **and** a text label — never colour alone.
- Interactive non-button elements (service cards) are keyboard-operable
  (`role="button"`, `tabIndex`, Enter/Space).

## User themes

Muxly themes follow a semantic-token model. Presets provide complete palettes,
while `settings.json` stores only the selected preset and optional custom
overrides. Missing or invalid values fall back to the built-in design tokens,
so older and partially authored settings remain safe.

```json
{
  "themePreset": "custom",
  "theme": {
    "appBackground": "#101215",
    "surfaceBackground": "#15181d",
    "border": "#2a2d31",
    "hoverSubtle": "#1b1e23",
    "textPrimary": "#f4f4f5",
    "accent": "#22d3ee",
    "info": "#38bdf8",
    "terminalBackground": "#101215",
    "terminalForeground": "#d4d4d8"
  }
}
```

Accepted values are six-digit hexadecimal colours. `settings.json` lives beside
`services.json` in the OS app-config directory documented in
`docs/services-config.md`. Available semantic keys are defined by `MuxlyTheme`
in `src/theme.ts`; unknown keys are discarded by the backend. Presets are
`default`, `midnight`, and `high-contrast`. Settings applies
theme previews live to mounted React controls and xterm terminals, warns when
primary text pairs fall below the WCAG 4.5:1 target, and restores the saved
palette when an unsaved preview is closed.

Reset and save defaults persists the default theme immediately and confirms
success inline. Preset selection, colour edits, and group resets remain previews
until Save theme is pressed.

Each semantic colour row provides both direct six-digit hex entry and a themed,
keyboard-accessible saturation and hue picker opened from its colour swatch.
