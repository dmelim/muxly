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
| `bg/app`         | `#101215`   | App background                                 |
| `bg/surface`     | `#15181d`   | Sidebars, inspector, panels, default terminals |
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
| Background   | `#15181d` |
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

Both sidebars are collapsible to 44px icon rails and drag-resizable when open.
Their toggle buttons sit at the inner edges: Services beside its heading and
Details in the action bar above the inspector. A closed sidebar shows its
reopen button. Terminal panes are split horizontally with draggable dividers.
The terminal grid and both side panels
share an 8px bottom inset. Minimum window size is 1024×680.

Spacing follows Tailwind's 4px scale. Common rhythm: `p-3` (panes, cards),
`px-5 py-4` (panel headers), `gap-2`/`gap-3` (control clusters).

## Shape & elevation

- **Radius** — `rounded-md` (6px) is the default for buttons, cards, inputs,
  tooltips, and badges. Status dots and avatars are `rounded-full`.
- **Borders** — 1px `white/10`. Selected/active items use a subtle fill
  (with a hairline inset outline where needed), not a coloured side stripe.
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
(or the hover split icon) opens it in an additional pane. State: the selected
card is a flat `white/7` fill with a 1px inset `white/8` hairline, like native
list selection; open cards show the accent terminal icon in the top-right
corner; other cards are transparent until hover. No coloured side stripes. The status dot and name lead; the command shows in muted monospace.
Project group headers carry the pin action. Pinned projects form a stable group
at the top of the sidebar while service order inside each project is unchanged.
Dragging a service card into the terminal workspace opens it as a tab in the
hovered panel; an empty workspace accepts the same gesture and creates its first
panel. The destination uses a dashed cyan outline and a short drop label.

### Panels & dividers

The left sidebar has one inset panel with 8px outer spacing and 4px spacing
toward the workspace. Its controls and
filters remain fixed above a separately scrolling service list with a fixed
Services heading. The whole panel uses the slightly lighter surface background
(`bg/surface`) without an outer border, creating soft separation from the app
background.
Workspace actions and the Hide Details button sit in a horizontal, borderless
surface bar above the Details inspector, pushing the inspector down. When
Details is collapsed, the actions stack vertically beneath its reopen button
in the narrow icon rail. Closed sidebar controls begin at the same height as
the terminal tabs, or the terminal body when tabs are disabled.
The terminal workspace starts at the 8px top inset without a central toolbar.
Its tabs start at that inset, aligned with the Details action bar.
The Details sidebar uses the same borderless, slightly lighter inset panel with
8px outer spacing and 4px spacing toward the workspace. Its header groups the
editor, folder, browser, and Edit actions beside the title without a separator below.

The terminal grid has 4px side insets and 8px between panels, so the gaps
between both sidebars and the terminal panels match the 8px outer insets.
When a sidebar is hidden, the workspace gains the missing 4px so its outer
inset stays 8px.

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
The 3.5px accent-coloured scrollbar thumb is 30% shorter than its proportional length and overlays the inside of the terminal panel just below the tab row, without reserving space between tabs and terminal.
Tabs use a compact fixed width and truncate
long labels; the active tab scrolls into view. A normal service click opens a tab in
the focused panel; `Ctrl/Cmd`-click creates another panel with its own tabs.
Tabs can be reordered within a panel or dragged to another panel; an insertion
preview shaped like a muted copy of the dragged tab shows the exact drop
position in destination panels without duplicating the tab in its source panel,
and an emptied source panel is removed.
The service workspace below each tab strip uses the lighter terminal surface
without an outer outline. The rounded active tab uses the same background,
while the rest of the tab row remains transparent. The focused tab uses cyan
text to identify its panel.

The bottom shell drawer is inset with `mx-1 mb-2`, aligning its sides with the
4px terminal-grid insets and the 8px gaps beside the sidebars. It uses the same
lighter, borderless terminal surface as the workspace panels, without a header divider.
Its header uses the shared Dropdown for installed shell profiles. Switching profiles ends
the current session through an in-app confirmation; the choice survives drawer
close/reopen for the current app session.

### Scrollbars

All horizontal and vertical scrollbars share a square 3.5px accent thumb
inside a transparent 10px track, with accent/soft hover and accent/strong
pressed colours. Shared CSS tokens control the dimensions and colours for
native scroll surfaces, custom sidebar and tab tracks, and xterm. Scrollbars
reveal on hover or keyboard focus; native fallback uses a thin accent bar.
Custom sidebar and tab thumbs retain their 30% shorter length with full-track
travel. Native views and xterm retain their own scroll geometry. No arrow
buttons. xterm's horizontal scrollbar is hidden because terminal output wraps.

### Stream mode

Stream mode is an in-place audience filter, not a separate workspace. The
normal service layout, status, controls, logs, and bottom shell stay visible so
the operator can continue working while sharing the Muxly window.

The real terminal stays on screen in Stream mode, with its colours, font,
spacing, wrapping, scrollbar, selection, and input unchanged. Only the sensitive
values are covered. Each value that the stream redactor would replace (absolute
and home-relative paths, email addresses, external URLs, and configured
sensitive identities) gets a cell-aligned xterm decoration. The decoration
paints a flat `white/7` fill over the terminal background and shows the
redaction label, such as `[private path]`, in the muted terminal colour. The
masks are painted in the same frame as the text they cover. Values that wrap
across rows get one mask per row. Copying a selection copies what the masks
show: masks are worked out from the whole line, so selecting any part of a
hidden value copies its label rather than the fragment.

Masking fails closed: if a change can't be traced back to exact cells, the whole
changed span is covered, and if the redactor fails, the whole line is covered.
Full-screen programs that use the alternate screen are covered entirely, because
cursor-addressed output can't be read reliably line by line. Link opening and
Find in pane are disabled while Stream mode is on. Turning Stream mode off
removes the masks without restarting or replaying the terminal.

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
    "terminalBackground": "#15181d",
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
