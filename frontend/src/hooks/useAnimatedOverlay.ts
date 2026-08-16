import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createScope } from 'animejs';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';
import { registerOverlay, unregisterOverlay } from '../lib/overlayState';

type AnimScope = ReturnType<typeof createScope>;
type OverlayToken = number;

let nextOverlayToken = 0;
const overlayTokenStack: OverlayToken[] = [];

export function registerOverlayToken(): OverlayToken {
  const token = ++nextOverlayToken;
  overlayTokenStack.push(token);
  return token;
}

export function unregisterOverlayToken(token: OverlayToken): void {
  const index = overlayTokenStack.lastIndexOf(token);
  if (index >= 0) {
    overlayTokenStack.splice(index, 1);
    return;
  }
  overlayTokenStack.pop();
}

export function isTopOverlayToken(token: OverlayToken | null | undefined): boolean {
  if (token == null) return false;
  return overlayTokenStack[overlayTokenStack.length - 1] === token;
}

/**
 * Entrance callback — runs inside a `createScope().add()` block.
 * Set initial hidden state, then animate to visible.
 * If `prefersReduced` is true, set final state instantly (no animation).
 * Consumers import `animate`/`utils`/`spring` from animejs directly.
 */
export type EntranceFn = (
  overlay: HTMLDivElement,
  content: HTMLElement,
  prefersReduced: boolean,
) => void;

/**
 * Exit callback — runs outside scope.
 * Animate to hidden state, then call `onDone`.
 * Consumers import `animate` from animejs directly.
 */
export type ExitFn = (
  overlay: HTMLDivElement,
  content: HTMLElement,
  onDone: () => void,
) => void;

export interface UseAnimatedOverlayOptions {
  overlayRef: { current: HTMLDivElement | null };
  contentRef: { current: HTMLElement | null };
  isOpen: boolean;
  onClose: () => void;
  entrance: EntranceFn;
  exit: ExitFn;
}

/**
 * Shared animation lifecycle for overlay-based components (Modal, Drawer, ConfirmDialog).
 *
 * Manages the `visible`/`wasOpen` state machine, scope lifecycle, close-generation
 * invalidation, and guarded close handler. Consumers provide `entrance` and `exit`
 * callbacks that define the actual animation keyframes.
 *
 * Returns `{ visible, handleClose }` — use `visible` for conditional rendering
 * and `handleClose` for close triggers (overlay click, X button, etc.).
 */
export function useAnimatedOverlay({
  overlayRef,
  contentRef,
  isOpen,
  onClose,
  entrance,
  exit,
}: UseAnimatedOverlayOptions): {
  visible: boolean;
  handleClose: () => void;
  overlayToken: OverlayToken | null;
} {
  const scopeRef = useRef<AnimScope | null>(null);
  const isClosingRef = useRef(false);
  const closeGenRef = useRef(0);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const overlayTokenRef = useRef<OverlayToken | null>(null);
  const [visible, setVisible] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  const [overlayToken, setOverlayToken] = useState<OverlayToken | null>(null);
  const prefersReduced = usePrefersReducedMotion();

  // Keep callbacks in refs so effects don't re-run on identity changes
  const entranceRef = useRef(entrance);
  entranceRef.current = entrance;
  const exitRef = useRef(exit);
  exitRef.current = exit;

  // Track isOpen transitions — open: mount DOM; close: run exit animation then unmount
  useEffect(() => {
    if (isOpen && !wasOpen) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      setVisible(true);
      setWasOpen(true);
      isClosingRef.current = false;
      closeGenRef.current++; // invalidate any pending close animation
    } else if (!isOpen && wasOpen) {
      setWasOpen(false);
      const overlay = overlayRef.current;
      const content = contentRef.current;
      const restoreTarget = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (restoreTarget?.isConnected) requestAnimationFrame(() => restoreTarget.focus());

      if (prefersReduced || !overlay || !content) {
        setVisible(false);
        return;
      }

      isClosingRef.current = true;
      const closeGen = ++closeGenRef.current;

      exitRef.current(overlay, content, () => {
        if (closeGenRef.current === closeGen) {
          setVisible(false);
        }
        isClosingRef.current = false;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable; intentionally mirrors original Drawer/ConfirmDialog deps
  }, [isOpen, wasOpen, prefersReduced]);

  useEffect(() => {
    if (!visible) {
      if (overlayTokenRef.current != null) {
        unregisterOverlayToken(overlayTokenRef.current);
        overlayTokenRef.current = null;
      }
      setOverlayToken((current) => (current == null ? current : null));
      return;
    }

    if (overlayTokenRef.current == null) {
      overlayTokenRef.current = registerOverlayToken();
      setOverlayToken(overlayTokenRef.current);
    }

    return () => {
      if (overlayTokenRef.current != null) {
        unregisterOverlayToken(overlayTokenRef.current);
        overlayTokenRef.current = null;
      }
    };
  }, [visible]);

  // Apply the hidden entrance state before the overlay's first visible paint.
  // The entrance callbacks begin by resetting opacity/transform, so a passive
  // effect would briefly paint the CSS default (fully visible) before fading in.
  useLayoutEffect(() => {
    if (!visible || !wasOpen) return;
    const overlay = overlayRef.current;
    const content = contentRef.current;
    if (!overlay || !content) return;

    const scope = createScope({ root: overlay }).add(() => {
      entranceRef.current(overlay, content, prefersReduced);
    });

    scopeRef.current = scope;

    return () => {
      scope.revert();
      scopeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable; intentionally mirrors original Drawer/ConfirmDialog deps
  }, [visible, wasOpen, prefersReduced]);

  // Cleanup scope on unmount
  useEffect(() => {
    return () => {
      scopeRef.current?.revert();
      scopeRef.current = null;
    };
  }, []);

  // Register as an open overlay while visible (open + exit animation) so the ESC
  // "go back" shortcut yields and lets this overlay consume ESC instead.
  useEffect(() => {
    if (!visible) return;
    registerOverlay();
    return () => unregisterOverlay();
  }, [visible]);

  // Guarded close — prevents double-fire during exit animation
  const handleClose = useCallback(() => {
    if (isClosingRef.current) return;
    onClose();
  }, [onClose]);

  return { visible, handleClose, overlayToken };
}
