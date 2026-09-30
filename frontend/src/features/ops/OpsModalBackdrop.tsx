import type { ReactNode } from 'react';
import { Modal } from '../../design-system/Modal';

/**
 * Thin adapter (card 20260930_227): the ops dialog skins (.ops-modal*) ride
 * the one design-system modal module in bare mode. Portal-to-body, scrim,
 * Escape (picker-deferent), focus trap + return and body scroll lock are
 * module-owned; the ops surface chrome (.ops-modal__head/__body/__foot) stays
 * with the dialogs that render it. Scrim clicks never dismiss — these
 * dialogs host editable forms, so an accidental click must not discard work.
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
  return (
    <Modal chrome="bare" title={ariaLabel} ariaLabel={ariaLabel} isOpen onClose={onClose}>
      {children}
    </Modal>
  );
}
