import { useEffect, useRef } from 'react';

/**
 * Dialog dismissal + focus contract for the ops modal shell: Escape closes,
 * focus returns to the opener on unmount. Additive by design — dialogs keep
 * their markup and only gain the ref. Events whose target sits outside the
 * dialog (e.g. a SearchableSelect popover portal) are ignored, so closing
 * such a popover with Escape never dismisses the dialog underneath.
 */
export function useOpsModalDismiss<T extends HTMLElement>(onClose: () => void) {
  const backdropRef = useRef<T>(null);

  useEffect(() => {
    const backdrop = backdropRef.current;
    if (!backdrop) return undefined;
    const opener = document.activeElement as HTMLElement | null;

    // Focus entry: the dialog takes focus so Escape and Tab work from the
    // moment it opens, whatever the opener's focus behavior.
    backdrop.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      const targetInside = event.target instanceof Node && backdrop.contains(event.target);
      if (!targetInside) return undefined;
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      return undefined;
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      opener?.focus?.();
    };
  }, [onClose]);

  return backdropRef;
}
