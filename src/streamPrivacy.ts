type PrivacyTerminal = {
  options: { disableStdin?: boolean };
  clearSelection(): void;
  blur(): void;
  paste(text: string): void;
};

/** Preserve the raw parser, scrollback and process while the redacted mirror owns input. */
export function setTerminalConcealed(terminal: PrivacyTerminal, concealed: boolean) {
  terminal.options.disableStdin = concealed;
  if (concealed) {
    terminal.clearSelection();
    terminal.blur();
  }
}

/** Let xterm normalize and bracket a paste while its hidden input stays disabled. */
export function pasteIntoRedactedTerminal(terminal: PrivacyTerminal, text: string) {
  const disabled = terminal.options.disableStdin;
  terminal.options.disableStdin = false;
  try {
    terminal.paste(text);
  } finally {
    terminal.options.disableStdin = disabled;
  }
}
