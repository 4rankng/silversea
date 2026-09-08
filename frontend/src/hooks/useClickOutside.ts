import { useEffect, type RefObject } from 'react';
import { registerOverlay, unregisterOverlay } from '../lib/overlayState';
import { registerOverlayToken, unregisterOverlayToken } from './useAnimatedOverlay';

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
    // "go back" shortcut yields and parent overlays (Drawer/Modal) yield while it's open.
    let token: number | null = null;
    if (escapeKey) {
      registerOverlay();
      token = registerOverlayToken();
    }
    const handler = (e: MouseEvent | KeyboardEvent | PointerEvent) => {
      if (e instanceof KeyboardEvent) {
        if (escapeKey && e.key === 'Escape') {
          e.stopPropagation();
          onDismiss();
        }
        return;
      }
      const target = e.target as Node;
      const isInside = [ref, ...(additionalRefs ?? [])].some((candidate) => candidate.current?.contains(target));
      if (!isInside) {
        onDismiss();
      }
    };
    document.addEventListener('pointerdown', handler);
    document.addEventListener('mousedown', handler);
    if (escapeKey) document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('pointerdown', handler);
      document.removeEventListener('mousedown', handler);
      if (escapeKey) {
        document.removeEventListener('keydown', handler);
        unregisterOverlay();
        if (token != null) unregisterOverlayToken(token);
      }
    };
  }, [additionalRefs, ref, onDismiss, enabled, escapeKey]);
}

