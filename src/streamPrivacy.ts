import type { ServiceConfig } from "./types";

/** Output is an arbitrary terminal protocol, not independently redactable text. */
export function isServiceOutputHidden(service: Pick<ServiceConfig, "sensitive">, streamMode: boolean) {
  return streamMode && Boolean(service.sensitive);
}

type PrivacyTerminal = {
  options: { disableStdin?: boolean };
  clearSelection(): void;
  blur(): void;
};

/** Preserve the parser, scrollback and process; disable user access to hidden data. */
export function setTerminalConcealed(terminal: PrivacyTerminal, concealed: boolean) {
  terminal.options.disableStdin = concealed;
  if (concealed) {
    terminal.clearSelection();
    terminal.blur();
  }
}
