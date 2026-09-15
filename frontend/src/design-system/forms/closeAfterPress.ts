/**
 * Defer a picker-panel close until the in-flight press has fully landed.
 *
 * react-aria selects ListBox options at pointerdown; closing the panel
 * synchronously inside that handler orphans the gesture's mousedown, which
 * the browser retargets to <body> — and parent dialogs' outside-press
 * detectors read that as an outside tap (card _8: minute-tap dismissed the
 * whole schedule dialog with draft loss). Closing on pointerup — with a
 * short timer backstop so keyboard commits (no pointerup coming) still
 * close — keeps the panel in the DOM for the entire gesture.
 */
export function closeAfterPress(close: () => void): void {
  let closed = false;
  const settle = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('pointerup', settle, true);
    close();
  };
  window.addEventListener('pointerup', settle, { capture: true });
  window.setTimeout(settle, 150);
}
