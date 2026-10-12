type CopyKeyEvent = Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "key" | "preventDefault" | "stopPropagation">;

/** Keep selected-text copy out of xterm's PTY input handler. */
export function handleTerminalCopyKey(
  event: CopyKeyEvent,
  hasSelection: boolean,
  copy: () => boolean = () => document.execCommand("copy")
): boolean {
  if (!hasSelection || !event.ctrlKey || event.metaKey || event.altKey || event.key.toLowerCase() !== "c") return false;
  event.stopPropagation();
  if (event.shiftKey) {
    // Ctrl+Shift+C has no browser default. Dispatch the synchronous native
    // copy event so the terminal's capture handler can redact the clipboard.
    event.preventDefault();
    copy();
  }
  // Plain Ctrl+C keeps its trusted native copy default, without reaching PTY.
  return true;
}
