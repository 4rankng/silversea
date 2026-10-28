import { useEffect, useState, type RefObject } from 'react';
import { useFocusTrap } from './useFocusTrap';
import { restoreFocusTo } from '../lib/focusRestore';

/**
 * Shared popover-dialog semantics (SIL-561).
 *
 * A `role="dialog"` popover that claims MODAL semantics must hold all three
 * legs at once — the audit found each popover holding at most one:
 *
 *   1. `aria-modal="true"` on the panel, so assistive tech ignores the page
 *      behind the dialog (Column picker rendered the role without it);
 *   2. focus LANDS INSIDE the panel on open and Tab cycles within it
 *      (FilterDropdown left focus on `<body>` on open);
 *   3. the background is `inert` while the dialog is open, so pointer and
 *      keyboard users cannot reach the page behind it (Column picker's
 *      background stayed live).
 *
 * Closing hands focus back to the trigger through the shared
 * `restoreFocusTo` owner — no dismissal path may drop the keyboard to
 * `<body>` (Escape, the apply button, a criterion selection that unmounts
 * the panel, an outside press that lands focus nowhere).
 *
 * Click-outside dismissal is deliberately NOT changed: `inert` removes the
 * background from hit-testing, so the document-level press lands on `<body>`
 * and the hosting `useClickOutside` still sees an outside press. The dialog
 * behaves like a select dropdown, not a page-blocking modal.
 *
 * NOT for every `role="dialog"`: hover-driven hovercards (the debit docs
 * badge would freeze the page under the pointer), dialogs nested INSIDE an
 * open modal (the sweep would inert the host dialog) and editors that
 * already own focus containment inside a Drawer trap (SIL-552) keep their
 * own mechanics.
 *
 * Design provenance (AGENTS.md reference-before-invention): the semantics
 * are the WAI-ARIA APG modal-dialog contract; the modal overlays in the
 * Untitled UI PRO v8 `application/modals` family (search_components
 * "dialog modal popover focus", consulted 29/10) carry the same
 * aria-modal + focus-in + blocked-background shape. The mechanics compose
 * the repo's own trio — `useFocusTrap` + `useClickOutside` + portal — that
 * the popover family already shares.
 */

/** Panel-gated effect body: some hosts mount the panel one layout pass after
 * `active` flips (the popover position gate), so each leg retries one frame
 * before giving up. Returns the leg's undo, or null when no panel appeared. */
function withPanel(
  panelRef: RefObject<HTMLElement | null>,
  apply: (panel: HTMLElement) => () => void,
): () => void {
  let undo: (() => void) | null = null;
  let cancelled = false;
  const attempt = (frame: number): void => {
    if (cancelled) return;
    const panel = panelRef.current;
    if (panel) {
      undo = apply(panel);
      return;
    }
    if (frame === 0) requestAnimationFrame(() => attempt(1));
  };
  attempt(0);
  return () => {
    cancelled = true;
    undo?.();
  };
}

export interface UsePopoverDialogOptions {
  /**
   * Hand focus back to the trigger when a close strands it on `<body>`
   * (a press on dead space). True by default — the FilterDropdown/ColumnPicker
   * contract. The topbar month picker opts OUT (SIL-573): its outside press
   * leaves focus where the user clicked, and its own Escape handler already
   * restores the trigger.
   */
  restoreOnBody?: boolean;
}

export function usePopoverDialog(
  panelRef: RefObject<HTMLElement | null>,
  triggerRef: { readonly current: HTMLElement | null },
  active: boolean,
  options: UsePopoverDialogOptions = {},
): void {
  const restoreOnBody = options.restoreOnBody ?? true;

  // The focus trap activates only once the panel is actually mounted — a
  // position-gated host renders it one layout pass after `active` flips, and
  // a trap activated against a missing panel never attaches.
  const [panelMounted, setPanelMounted] = useState(false);
  useEffect(() => {
    if (!active) {
      setPanelMounted(false);
      return;
    }
    let cancelled = false;
    const attempt = (frame: number): void => {
      if (cancelled) return;
      if (panelRef.current) {
        setPanelMounted(true);
        return;
      }
      if (frame === 0) requestAnimationFrame(() => attempt(1));
    };
    attempt(0);
    return () => {
      cancelled = true;
    };
  }, [active, panelRef]);

  // Leg 2 — focus lands inside and Tab cycles within the panel (the
  // useFocusTrap contract). Nested portals (a criterion's date picker) are
  // appended to <body> AFTER this sweep, so they are never inert and stay
  // reachable; the panel-level Tab handler simply does not see keypresses
  // taken inside them.
  useFocusTrap(panelRef, active && panelMounted);

  useEffect(() => {
    if (!active) return;
    return withPanel(panelRef, (panel) => {
      // Leg 1 — modal semantics ride the panel only while it is open.
      panel.setAttribute('aria-modal', 'true');

      // Leg 3 — the rest of the page goes inert while the dialog is open.
      // The sweep walks DOWN from <body>: a child that contains the panel (a
      // portal target, or the app root hosting an unportaled picker) or the
      // TRIGGER (the opener's own island — it stays clickable and is the
      // focus-return target; a browser refuses to focus an inert element,
      // which would break the Escape restore) is stepped into, so only the
      // branches off that path are blocked — everything else loses pointer
      // and keyboard reach. Portals appended later (a criterion's date
      // picker) are never covered by the sweep and stay interactive.
      const previous = new Map<Element, boolean>();
      const trigger = triggerRef.current;
      const sweep = (parent: Element): void => {
        for (const child of Array.from(parent.children)) {
          // The panel and the trigger element itself (with everything inside
          // them) stay live; branches off their two paths are blocked.
          if (child === panel || (trigger != null && (child === trigger || trigger.contains(child)))) continue;
          if (child.contains(panel) || (trigger != null && child.contains(trigger))) {
            sweep(child);
            continue;
          }
          previous.set(child, child.hasAttribute('inert'));
          child.setAttribute('inert', '');
        }
      };
      sweep(document.body);

      return () => {
        panel.removeAttribute('aria-modal');
        for (const [child, hadAttribute] of previous) {
          if (!hadAttribute) child.removeAttribute('inert');
        }
      };
    });
  }, [active, panelRef]);

  // Focus return: any close that would strand the keyboard (focus was on the
  // now-unmounted panel, or nowhere) hands it back to the trigger. A close
  // that already left focus somewhere useful (the control an outside press
  // landed on, the trigger the Escape handler restored) is left alone.
  useEffect(() => {
    if (!active) return;
    const panel = panelRef.current;
    return () => {
      const current = document.activeElement;
      const stranded =
        current == null ||
        (current === document.body && restoreOnBody) ||
        (panel != null && current instanceof Node && panel.contains(current));
      if (stranded) restoreFocusTo(triggerRef.current);
    };
  }, [active, panelRef, triggerRef, restoreOnBody]);
}
