/** One owner for overlapping recovery overlays: never inert each other. */
type Gate = { panel: HTMLElement; priority: number; initialFocus: HTMLElement; display: string; displayPriority: string };
const gates = new Set<Gate>();
const originals = new Map<HTMLElement, string | null>();
let current: Gate | undefined;
let observer: MutationObserver | undefined;
let previousFocus: Element | null = null;
const focusableSelector = 'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])';

function focusGate() { current?.initialFocus.focus(); }
function synchronize() {
  const next = [...gates].filter(gate => gate.panel.isConnected).sort((a, b) => b.priority - a.priority)[0];
  // Inert alone does not stop a later sibling painting over the active panel.
  // Only the winning gate is visible, regardless of portal mounting order.
  for (const gate of gates) {
    if (gate === next) gate.panel.style.setProperty('display', gate.display, gate.displayPriority);
    else gate.panel.style.setProperty('display', 'none', 'important');
  }
  for (const node of document.body.children) {
    if (!(node instanceof HTMLElement)) continue;
    if (!originals.has(node)) originals.set(node, node.getAttribute('inert'));
    if (next && node !== next.panel) node.setAttribute('inert', '');
    else {
      const original = originals.get(node);
      if (original == null) node.removeAttribute('inert');
      else node.setAttribute('inert', original);
    }
  }
  if (current !== next) { current = next; focusGate(); }
}
function containFocus(event: FocusEvent) {
  if (current && (!(event.target instanceof Node) || !current.panel.contains(event.target))) focusGate();
}
function containClick(event: MouseEvent) {
  if (current && (!(event.target instanceof Node) || !current.panel.contains(event.target))) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
}
function containKey(event: KeyboardEvent) {
  if (!current) return;
  if (!(event.target instanceof Node) || !current.panel.contains(event.target)) {
    event.preventDefault();
    event.stopImmediatePropagation();
    focusGate();
    return;
  }
  if (event.key === 'Tab') {
    const controls = [...current.panel.querySelectorAll<HTMLElement>(focusableSelector)]
      .filter(element => !element.hidden && !element.closest('[inert]') && getComputedStyle(element).display !== 'none');
    const index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    if (!controls.length) focusGate();
    else if (index < 0) controls[event.shiftKey ? controls.length - 1 : 0].focus();
    else controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
  }
  // Native button activation still creates its click; page shortcuts do not run.
  event.stopPropagation();
}

export function isolateInteractionGate(panel: HTMLElement, priority: number, initialFocus: HTMLElement = panel): () => void {
  const gate = { panel, priority, initialFocus, display: panel.style.getPropertyValue('display'), displayPriority: panel.style.getPropertyPriority('display') };
  if (!gates.size) {
    previousFocus = document.activeElement;
    observer = new MutationObserver(synchronize);
    observer.observe(document.body, { childList: true });
    window.addEventListener('focusin', containFocus, true);
    window.addEventListener('keydown', containKey, true);
    window.addEventListener('click', containClick, true);
  }
  gates.add(gate);
  synchronize();
  return () => {
    if (!gates.delete(gate)) return;
    panel.style.setProperty('display', gate.display, gate.displayPriority);
    if (gates.size) { synchronize(); return; }
    observer?.disconnect();
    observer = undefined;
    window.removeEventListener('focusin', containFocus, true);
    window.removeEventListener('keydown', containKey, true);
    window.removeEventListener('click', containClick, true);
    current = undefined;
    for (const [element, inert] of originals) {
      if (inert === null) element.removeAttribute('inert');
      else element.setAttribute('inert', inert);
    }
    originals.clear();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    previousFocus = null;
  };
}
