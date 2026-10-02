import { useEffect, useRef, type RefObject } from 'react';
import { registerOverlay, unregisterOverlay } from '../lib/overlayState';
import { isTopOverlayToken, registerOverlayToken, unregisterOverlayToken } from './useAnimatedOverlay';

/**
 * Attach click-outside + optional Escape-key dismissal to a container ref.
 * The listener is only active while `enabled` is true (default: true).
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  options?: {
    escapeKey?: boolean;
    /** Escape can cancel a draft while an outside press commits its exit. */
    onEscape?: () => void;
    enabled?: boolean;
    additionalRefs?: RefObject<HTMLElement | null>[];
    /** Event targets inside a matching element never dismiss this layer —
     *  for portaled popovers (react-aria / SearchableSelect) whose own
     *  backdrop owns the outside interaction. */
    ignoreSelector?: string;
  },
) {
  const { escapeKey = false, enabled = true, ignoreSelector, onEscape } = options ?? {};
  const additionalRefs = options?.additionalRefs;
  const overlayTokenRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || !escapeKey) return;
    // Layer order follows opening/closing, not listener rebindings when a
    // parent rerenders its callbacks or additional refs after a child choice.
    registerOverlay();
    const token = registerOverlayToken();
    overlayTokenRef.current = token;
    return () => {
      unregisterOverlay();
      unregisterOverlayToken(token);
      overlayTokenRef.current = null;
    };
  }, [enabled, escapeKey]);

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: MouseEvent | KeyboardEvent | PointerEvent) => {
      // Targets inside an ignored region (e.g. a portaled select popover whose
      // own backdrop owns outside clicks) never dismiss this layer — pointer
      // and Escape alike, so a dropdown's own shortcuts stay self-contained.
      const path = e.composedPath();
      if (ignoreSelector && path.some((node) => node instanceof Element && node.matches(ignoreSelector))) return;
      if (e instanceof KeyboardEvent) {
        if (escapeKey && e.key === 'Escape' && !e.defaultPrevented && isTopOverlayToken(overlayTokenRef.current)) {
          // Native document listeners can run after a child commits its close
          // and unregisters its token. Consume this event before dismissal so
          // a later parent listener cannot close a second layer on the same key.
          e.preventDefault();
          e.stopPropagation();
          (onEscape ?? onDismiss)();
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
      }
    };
  }, [additionalRefs, ref, onDismiss, enabled, escapeKey, ignoreSelector, onEscape]);
}
