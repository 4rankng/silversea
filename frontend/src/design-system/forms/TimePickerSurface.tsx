import { type RefObject, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, Modal, ModalOverlay } from 'react-aria-components';
import { X } from 'lucide-react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { usePopoverPosition } from '../../hooks/usePopoverPosition';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { registerOverlayToken, unregisterOverlayToken } from '../../hooks/useAnimatedOverlay';
import { TimePanel } from './TimePanel';
import './TimePickerSurface.css';

export const TIME_PICKER_MOBILE_QUERY = '(max-width: 640px)';

/** One time surface for create, detail schedule and combined appointments.
 * The mobile modal contains its own exact entry, so it never depends on an
 * obscured or inert input behind the sheet. */
export function TimePickerSurface({ id, label, value, onPick, onDismiss, onExit, panelRef, anchorRef, additionalRefs = [], keyboard = false, inline = false }: {
  id?: string; label: string; value: string; onPick: (time: string) => void;
  onDismiss: () => void; onExit: () => void;
  panelRef: RefObject<HTMLDivElement | null>; anchorRef: RefObject<HTMLElement | null>;
  additionalRefs?: RefObject<HTMLElement | null>[]; keyboard?: boolean; inline?: boolean;
}) {
  const mobile = useMediaQuery(TIME_PICKER_MOBILE_QUERY);
  const position = usePopoverPosition(panelRef, anchorRef, !mobile && !inline, 240, 264);
  useFocusTrap(panelRef, !mobile && keyboard);
  useClickOutside(panelRef, onExit, { enabled: !mobile && !inline, additionalRefs: [anchorRef, ...additionalRefs] });

  // Card 20260915_6 + _8: while the picker surface is open — sheet, popover,
  // or inline — register an overlay token so the PARENT dialog's window-level
  // shortcuts (Escape / Enter in useConfirmShortcuts) yield to the picker,
  // and pointer-outside detectors treat the open panel as the top overlay.
  // Pressing the picker or its overlay must never also dismiss the whole
  // parent dialog.
  const sheetTokenRef = useRef<number | null>(null);
  useEffect(() => {
    const token = registerOverlayToken();
    sheetTokenRef.current = token;
    return () => unregisterOverlayToken(token);
  }, []);
  const content = <TimePanel value={value} onPick={onPick} />;
  const keyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onDismiss(); }
    if (event.key === 'Enter') event.stopPropagation();
  };
  const header = <header className="time-picker__header"><strong>Chọn giờ (24h)</strong><button type="button" aria-label="Đóng" onClick={onDismiss}><X size={14} aria-hidden="true" /></button></header>;
  if (mobile) return <ModalOverlay isOpen isDismissable onOpenChange={(open) => { if (!open) onDismiss(); }} className="time-picker__overlay" data-time-picker-overlay>
    <Modal className="time-picker__sheet">
      <Dialog id={id} ref={panelRef} aria-label={label} className="time-picker__dialog" data-escape-boundary="true">
        <div className="time-picker__content" onKeyDown={keyDown}>{header}{content}</div>
      </Dialog>
    </Modal>
  </ModalOverlay>;
  if (inline) return <div ref={panelRef} className="time-picker__inline" onKeyDown={keyDown}>{content}</div>;
  return createPortal(<div id={id} ref={panelRef} role="dialog" aria-label={label} className="time-picker__popup" data-escape-boundary="true"
    style={{ top: position?.top ?? 12, left: position?.left ?? 12 }} onKeyDown={keyDown}
    onBlur={(event) => {
      const next = event.relatedTarget as Node | null;
      if (next && !event.currentTarget.contains(next) && ![anchorRef, ...additionalRefs].some((ref) => ref.current?.contains(next))) onExit();
    }}>{header}{content}</div>, document.body);
}
