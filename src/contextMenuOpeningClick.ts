// macOS Control-click can open a menu before mouseup, then emit a click
// on the original trigger. Require a fresh press before accepting mouse clicks.
export function suppressContextMenuOpeningClick(target: Window) {
  let awaitingPress = true;
  const down = () => { awaitingPress = false; };
  const click = (event: MouseEvent) => {
    if (!awaitingPress || event.detail === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  target.addEventListener("pointerdown", down, { capture: true });
  target.addEventListener("click", click, { capture: true });
  return () => {
    target.removeEventListener("pointerdown", down, { capture: true });
    target.removeEventListener("click", click, { capture: true });
  };
}
