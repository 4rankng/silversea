import { useEffect, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap keyboard focus within a container element while active.
 * Tab / Shift+Tab cycle through focusable children only.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;

    const container = ref.current;
    const ownsFallbackTabIndex = !container.hasAttribute('tabindex');
    if (ownsFallbackTabIndex) container.tabIndex = -1;
    const focusContainer = () => container.focus({ preventScroll: true });
    const getFocusable = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
      if (element.tabIndex < 0 || element.matches(':disabled') || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      const style = getComputedStyle(element);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });

    // Focus the first focusable element when trap activates
    const focusable = getFocusable();
    if (focusable.length) focusable[0].focus();
    else focusContainer();

    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || e.defaultPrevented) return;
      const items = getFocusable();
      if (items.length === 0) {
        e.preventDefault();
        focusContainer();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];

      if (document.activeElement === container) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
        return;
      }

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    container.addEventListener('keydown', handler);
    return () => {
      container.removeEventListener('keydown', handler);
      if (ownsFallbackTabIndex && container.getAttribute('tabindex') === '-1') container.removeAttribute('tabindex');
    };
  }, [ref, active]);
}
