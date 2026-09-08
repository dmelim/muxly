import type { CustomEditor, EditorCandidate } from "./types";

export const MAX_CUSTOM_EDITORS = 32;
export const MAX_EDITOR_NAME_LENGTH = 80;
export const MAX_EDITOR_COMMAND_LENGTH = 1024;

export type EditorOptionSource = "detected" | "custom" | "saved";

export type EditorOption = {
  value: string;
  label: string;
  detail?: string;
  source: EditorOptionSource;
};

/**
 * Keep editor settings safe to pass to the native launcher. A command is a
 * single executable path or command name, so surrounding quotes are removed
 * as a convenience but no shell-style splitting or interpolation is done.
 */
export function normalizeEditorCommand(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0") || /[\r\n]/.test(trimmed)) return fallback;
  if (Array.from(trimmed).length > MAX_EDITOR_COMMAND_LENGTH) return fallback;
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const unquoted = trimmed.slice(1, -1).trim();
      if (!unquoted || unquoted.includes("\0") || /[\r\n]/.test(unquoted)) return fallback;
      return Array.from(unquoted).length <= MAX_EDITOR_COMMAND_LENGTH ? unquoted : fallback;
    }
  }
  return trimmed;
}

function isWindows(): boolean {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
}

function normalizedKey(command: string, windows = isWindows()): string {
  // Unix paths may differ only in case or contain literal backslashes.
  return windows ? command.trim().replaceAll("\\", "/").toLowerCase() : command.trim();
}

function safeText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes("\0") || /[\r\n]/.test(trimmed)) return "";
  return Array.from(trimmed).length > maxLength ? "" : trimmed;
}

/** Normalize old, malformed, or partially edited custom editor values. */
export function normalizeCustomEditors(value: unknown, windows = isWindows()): CustomEditor[] {
  if (!Array.isArray(value)) return [];
  const result: CustomEditor[] = [];
  const seenCommands = new Set<string>();
  const seenIds = new Set<string>();

  for (let index = 0; index < value.length && result.length < MAX_CUSTOM_EDITORS; index += 1) {
    const item = value[index];
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const name = safeText(record.name, MAX_EDITOR_NAME_LENGTH);
    const command = normalizeEditorCommand(record.command);
    if (!name || !command) continue;

    const commandKey = normalizedKey(command, windows);
    if (seenCommands.has(commandKey)) continue;
    seenCommands.add(commandKey);

    let id = safeText(record.id, 120) || `custom-editor-${index + 1}`;
    if (seenIds.has(id)) {
      let suffix = 2;
      while (seenIds.has(`${id}-${suffix}`)) suffix += 1;
      id = `${id}-${suffix}`;
    }
    seenIds.add(id);
    result.push({ id, name, command });
  }

  return result;
}

function basename(command: string): string {
  const pieces = command.replaceAll("\\", "/").split("/");
  return pieces[pieces.length - 1] || command;
}

// Match only known bare launcher aliases. Explicit paths must keep their identity:
// two installations of the same product may intentionally be different editors.
const EDITOR_ALIASES: Record<string, string[]> = {
  vscode: ["code"], "vscode-insiders": ["code-insiders"], cursor: ["cursor"],
  windsurf: ["windsurf"], zed: ["zed"], sublime: ["subl", "sublime_text"],
  "notepad++": ["notepad++"], intellij: ["idea", "idea64"],
  pycharm: ["pycharm", "pycharm64"], webstorm: ["webstorm", "webstorm64"],
  rider: ["rider", "rider64"], clion: ["clion", "clion64"],
  goland: ["goland", "goland64"], datagrip: ["datagrip", "datagrip64"],
  rubymine: ["rubymine", "rubymine64"], phpstorm: ["phpstorm", "phpstorm64"],
  rustrover: ["rustrover", "rustrover64"]
};

export function editorAliasId(command: string, windows = isWindows()): string | undefined {
  if (/[\\/]/.test(command)) return undefined;
  const alias = windows ? command.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "") : command;
  return Object.entries(EDITOR_ALIASES).find(([, aliases]) => aliases.includes(alias))?.[0];
}

/** Retain unknown defaults while resolving known legacy aliases to detections. */
export function buildEditorOptions(
  detected: EditorCandidate[] | null | undefined,
  customValue: unknown,
  configuredValue: unknown
): EditorOption[] {
  const configured = normalizeEditorCommand(configuredValue);
  const custom = normalizeCustomEditors(customValue);
  const candidates = (detected ?? []).filter((editor) => editor && safeText(editor.label, MAX_EDITOR_NAME_LENGTH) && normalizeEditorCommand(editor.command || editor.path));
  const match = (command: string) => {
    const key = normalizedKey(command);
    const aliasId = editorAliasId(command);
    return candidates.find((editor) =>
      normalizedKey(editor.command || editor.path || "") === key
      || (aliasId !== undefined && editor.id === aliasId));
  };
  const preferred = match(configured);
  const customDefault = custom.find((editor) => normalizedKey(editor.command) === normalizedKey(configured));
  const options: EditorOption[] = [];
  const seen = new Set<string>();
  const add = (option: EditorOption) => {
    const key = normalizedKey(option.value);
    if (!seen.has(key)) { seen.add(key); options.push(option); }
  };
  if (configured) {
    add({ value: configured, label: customDefault?.name ?? preferred?.label ?? editorDisplayName(configured), source: customDefault ? "custom" : preferred ? "detected" : "saved" });
    if (preferred) seen.add(normalizedKey(preferred.command || preferred.path || ""));
  }
  for (const editor of custom) add({ value: editor.command, label: editor.name, source: "custom" });
  for (const editor of candidates) add({ value: normalizeEditorCommand(editor.command || editor.path), label: editor.label, source: "detected" });
  const first = configured ? options.shift() : undefined;
  options.sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
  return first ? [first, ...options] : options;
}

export function editorCommandKey(command: string, windows = isWindows()): string {
  return normalizedKey(command, windows);
}

export function editorDisplayName(command: string): string {
  return basename(normalizeEditorCommand(command, "Editor"));
}
