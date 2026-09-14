import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useOpsModalDismiss } from './useOpsModalDismiss';

/**
 * Portaled ops modal backdrop — renders into document.body so the dialog
 * always sits above the topbar and sidebar stacking contexts.
 *
 * Replaces the inline `<div className="ops-modal-backdrop">` pattern that
 * every ops modal previously used.  The children must include a single
 * `.ops-modal` wrapper with the dialog content.
 */
export function OpsModalBackdrop({
  onClose,
  ariaLabel,
  children,
}: {
  onClose: () => void;
  ariaLabel: string;
  children: ReactNode;
}) {
  const backdropRef = useOpsModalDismiss<HTMLDivElement>(onClose);

  return createPortal(
    <div ref={backdropRef} tabIndex={-1} className="ops-modal-backdrop" role="dialog" aria-modal="true" aria-label={ariaLabel}>
      {children}
    </div>,
    document.body,
  );
}
