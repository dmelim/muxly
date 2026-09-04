export type MuxlyTheme = {
  appBackground: string;
  surfaceBackground: string;
  elevatedBackground: string;
  border: string;
  hoverSubtle: string;
  hoverStrong: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  accentContrast: string;
  stopped: string;
  starting: string;
  running: string;
  stopping: string;
  exited: string;
  failed: string;
  warning: string;
  danger: string;
  info: string;
  terminalBackground: string;
  terminalForeground: string;
  terminalCursor: string;
  terminalSelection: string;
};

export type ThemePresetId = "default" | "midnight" | "high-contrast" | "custom";

export const DEFAULT_THEME: MuxlyTheme = {
  appBackground: "#101215",
  surfaceBackground: "#15181d",
  elevatedBackground: "#18181b",
  border: "#2a2d31",
  hoverSubtle: "#1b1e23",
  hoverStrong: "#25282d",
  textPrimary: "#f4f4f5",
  textSecondary: "#d4d4d8",
  textMuted: "#71717a",
  accent: "#22d3ee",
  accentStrong: "#06b6d4",
  accentSoft: "#67e8f9",
  accentContrast: "#083344",
  stopped: "#52525b",
  starting: "#fbbf24",
  running: "#22d3ee",
  stopping: "#fb923c",
  exited: "#38bdf8",
  failed: "#fb7185",
  warning: "#f59e0b",
  danger: "#f43f5e",
  info: "#38bdf8",
  terminalBackground: "#101215",
  terminalForeground: "#d4d4d8",
  terminalCursor: "#22d3ee",
  terminalSelection: "#3f3f46"
};

export const THEME_PRESETS: Record<Exclude<ThemePresetId, "custom">, MuxlyTheme> = {
  default: DEFAULT_THEME,
  midnight: {
    ...DEFAULT_THEME,
    appBackground: "#080d18",
    surfaceBackground: "#0d1422",
    elevatedBackground: "#131c2c",
    accent: "#60a5fa",
    accentStrong: "#3b82f6",
    accentSoft: "#93c5fd",
    accentContrast: "#172554",
    running: "#60a5fa",
    terminalBackground: "#080d18",
    terminalCursor: "#60a5fa",
    terminalSelection: "#26354f"
  },
  "high-contrast": {
    ...DEFAULT_THEME,
    appBackground: "#050505",
    surfaceBackground: "#0d0d0d",
    elevatedBackground: "#171717",
    textPrimary: "#ffffff",
    textSecondary: "#f4f4f5",
    textMuted: "#a1a1aa",
    accent: "#22d3ee",
    accentStrong: "#22d3ee",
    accentSoft: "#a5f3fc",
    accentContrast: "#000000",
    terminalBackground: "#050505",
    terminalForeground: "#ffffff",
    terminalSelection: "#3f3f46"
  }
};

const HEX = /^#[0-9a-f]{6}$/i;

export function normalizeThemeOverrides(value?: Partial<MuxlyTheme> | null): Partial<MuxlyTheme> {
  if (!value) return {};
  const out: Partial<MuxlyTheme> = {};
  for (const key of Object.keys(DEFAULT_THEME) as Array<keyof MuxlyTheme>) {
    const color = value[key];
    if (typeof color === "string" && HEX.test(color.trim())) {
      out[key] = color.trim().toLowerCase();
    }
  }
  return out;
}

export function resolveTheme(
  preset: ThemePresetId | undefined,
  overrides?: Partial<MuxlyTheme> | null
): MuxlyTheme {
  const base = preset && preset !== "custom" ? THEME_PRESETS[preset] : DEFAULT_THEME;
  return { ...base, ...normalizeThemeOverrides(overrides) };
}

export function applyTheme(theme: MuxlyTheme) {
  const style = document.documentElement.style;
  const values: Record<string, string> = {
    "--muxly-bg-app": theme.appBackground,
    "--muxly-bg-surface": theme.surfaceBackground,
    "--muxly-bg-elevated": theme.elevatedBackground,
    "--muxly-border": theme.border,
    "--muxly-hover-subtle": theme.hoverSubtle,
    "--muxly-hover-strong": theme.hoverStrong,
    "--muxly-terminal-bg": theme.terminalBackground,
    "--muxly-status-running": theme.running,
    "--color-zinc-100": theme.textPrimary,
    "--color-zinc-200": theme.textSecondary,
    "--color-zinc-300": theme.textSecondary,
    "--color-zinc-400": theme.textSecondary,
    "--color-zinc-500": theme.textMuted,
    "--color-zinc-600": theme.stopped,
    "--color-cyan-300": theme.accentSoft,
    "--color-cyan-400": theme.accent,
    "--color-cyan-500": theme.accentStrong,
    "--color-cyan-950": theme.accentContrast,
    "--color-amber-300": theme.starting,
    "--color-amber-400": theme.starting,
    "--color-amber-500": theme.warning,
    "--color-orange-400": theme.stopping,
    "--color-sky-400": theme.exited,
    "--color-rose-400": theme.failed,
    "--color-rose-500": theme.danger
  };
  for (const [name, value] of Object.entries(values)) style.setProperty(name, value);
  document.documentElement.style.colorScheme = "dark";
}

export function xtermTheme(theme: MuxlyTheme) {
  return {
    background: theme.terminalBackground,
    foreground: theme.terminalForeground,
    cursor: theme.terminalCursor,
    selectionBackground: theme.terminalSelection,
    black: theme.appBackground,
    red: theme.danger,
    green: theme.running,
    yellow: theme.warning,
    blue: theme.info,
    magenta: theme.failed,
    cyan: theme.accent,
    white: theme.textSecondary,
    brightBlack: theme.textMuted,
    brightRed: theme.failed,
    brightGreen: theme.running,
    brightYellow: theme.starting,
    brightBlue: theme.info,
    brightMagenta: theme.failed,
    brightCyan: theme.accentSoft,
    brightWhite: theme.textPrimary
  };
}

export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const [r, g, b] = channels.map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
