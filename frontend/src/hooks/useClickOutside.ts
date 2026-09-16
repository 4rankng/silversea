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
    /** Event targets inside a matching element never dismiss this layer —
     *  for portaled popovers (react-aria / SearchableSelect) whose own
     *  backdrop owns the outside interaction. */
    ignoreSelector?: string;
  },
) {
  const { escapeKey = false, enabled = true, ignoreSelector } = options ?? {};
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
      // Targets inside an ignored region (e.g. a portaled select popover whose
      // own backdrop owns outside clicks) never dismiss this layer — pointer
      // and Escape alike, so a dropdown's own shortcuts stay self-contained.
      const path = e.composedPath();
      if (ignoreSelector && path.some((node) => node instanceof Element && node.matches(ignoreSelector))) return;
      if (e instanceof KeyboardEvent) {
        if (escapeKey && e.key === 'Escape') {
          e.stopPropagation();
          onDismiss();
        }
        return;
      }
      // The event path retains ownership if a child selects and unmounts
      // before this document listener runs.
      const isInside = [ref, ...(additionalRefs ?? [])].some((candidate) =>
        candidate.current != null && path.includes(candidate.current),
      );
      if (!isInside) {
        onDismiss();
      }
    };
    // A picker may select and unmount on pointerdown. Its compatibility
    // mousedown can then target <body>; handling both dismisses the parent
    // editor even though the user only selected an option in the child.
    const pressEvent = typeof window.PointerEvent === 'function' ? 'pointerdown' : 'mousedown';
    document.addEventListener(pressEvent, handler);
    if (escapeKey) document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener(pressEvent, handler);
      if (escapeKey) {
        document.removeEventListener('keydown', handler);
        unregisterOverlay();
        if (token != null) unregisterOverlayToken(token);
      }
    };
  }, [additionalRefs, ref, onDismiss, enabled, escapeKey, ignoreSelector]);
}
