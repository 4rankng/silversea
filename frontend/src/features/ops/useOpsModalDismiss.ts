import { useEffect, useRef } from 'react';
import { registerOverlay, unregisterOverlay } from '../../lib/overlayState';

/**
 * Dialog dismissal + focus contract for the ops modal shell: Escape closes,
 * focus returns to the opener on unmount. Additive by design — dialogs keep
 * their markup and only gain the ref. Events whose target sits outside the
 * dialog (e.g. a SearchableSelect popover portal) are ignored, so closing
 * such a popover with Escape never dismisses the dialog underneath.
 */
export function useOpsModalDismiss<T extends HTMLElement>(onClose: () => void) {
  const backdropRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return undefined;
    const opener = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    registerOverlay();

    // Focus entry: the dialog takes focus so Escape and Tab work from the
    // moment it opens, whatever the opener's focus behavior.
    backdrop.focus({ preventScroll: true });

    const pickerEscapes = new WeakSet<KeyboardEvent>();
    const capturePickerKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !(event.target instanceof Element)) return;
      // ComboBox keeps DOM focus on its input while a portalled list is open.
      // Its expanded state may already be false by the document bubble phase.
      if (event.target.closest('[aria-expanded="true"][aria-haspopup], [role="combobox"][aria-expanded="true"]')) {
        pickerEscapes.add(event);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // A nested React Aria/date picker owns the first Escape. Listen after
      // its handler rather than consuming the key during document capture.
      if (event.defaultPrevented || pickerEscapes.has(event)) return undefined;
      const targetInside = event.target instanceof Node && backdrop.contains(event.target);
      if (!targetInside) return undefined;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      }
      return undefined;
    };

    document.addEventListener('keydown', capturePickerKey, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', capturePickerKey, true);
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      unregisterOverlay();
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  return backdropRef;
}
