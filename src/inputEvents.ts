export function isPrimaryPress(event: { button: number; ctrlKey: boolean }, mac: boolean) {
  return event.button === 0 && !(mac && event.ctrlKey);
}

// Editing fields and portalled menus own their context-menu interaction.
// xterm's hidden textarea is the exception: it uses the pane's menu.
export function hasOwnContextMenu(target: Element) {
  return target.closest('[role="menu"], input, textarea:not(.xterm-helper-textarea), [contenteditable="true"]') !== null;
}
