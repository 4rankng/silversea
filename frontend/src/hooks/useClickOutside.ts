import { useEffect, type RefObject } from 'react';
import { registerOverlay, unregisterOverlay } from '../lib/overlayState';

/**
 * Attach click-outside + optional Escape-key dismissal to a container ref.
 * The listener is only active while `enabled` is true (default: true).
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  options?: {
    escapeKey?: boolean;
    enabled?: boolean;
    additionalRefs?: RefObject<HTMLElement | null>[];
  },
) {
  const { escapeKey = false, enabled = true } = options ?? {};
  const additionalRefs = options?.additionalRefs;

  useEffect(() => {
    if (!enabled) return;
    // A dismiss-on-ESC dropdown/overlay claims Escape — register so the ESC
    // "go back" shortcut yields while it's open.
    if (escapeKey) registerOverlay();
    const handler = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent) {
        if (escapeKey && e.key === 'Escape') onDismiss();
        return;
      }
      const target = e.target as Node;
      const isInside = [ref, ...(additionalRefs ?? [])].some((candidate) => candidate.current?.contains(target));
      if (!isInside) {
        onDismiss();
      }
    };
    document.addEventListener('mousedown', handler);
    if (escapeKey) document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      if (escapeKey) document.removeEventListener('keydown', handler);
      if (escapeKey) unregisterOverlay();
    };
  }, [additionalRefs, ref, onDismiss, enabled, escapeKey]);
}
