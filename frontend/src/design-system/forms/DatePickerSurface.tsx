import { type RefObject, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { usePopoverPosition } from '../../hooks/usePopoverPosition';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { DatePanel } from './DateTimePickerPanels';
import './DatePickerSurface.css';

/** The same calendar surface for date-only and split date/time fields. */
export function DatePickerSurface({ id, label, value, min, max, onPick, onDismiss, onExit, panelRef, anchorRef, additionalRefs = [], keyboard = false }: {
  id?: string; label: string; value: string; min?: string; max?: string;
  onPick: (date: string) => void; onDismiss: () => void; onExit: () => void;
  panelRef: RefObject<HTMLDivElement | null>; anchorRef: RefObject<HTMLElement | null>;
  additionalRefs?: RefObject<HTMLElement | null>[]; keyboard?: boolean;
}) {
  const position = usePopoverPosition(panelRef, anchorRef, true, 280, 260);
  const blurFrame = useRef<number | null>(null);
  useFocusTrap(panelRef, keyboard);
  useClickOutside(panelRef, onExit, { escapeKey: true, additionalRefs: [anchorRef, ...additionalRefs] });
  useEffect(() => () => { if (blurFrame.current != null) cancelAnimationFrame(blurFrame.current); }, []);
  const closeWhenFocusLeaves = (next: Node | null) => {
    if (![panelRef, anchorRef, ...additionalRefs].some((ref) => ref.current?.contains(next))) onExit();
  };
  return createPortal(
    <div id={id} ref={panelRef} className="date-picker__popup"
      style={{ top: position?.top ?? 12, left: position?.left ?? 12 }}
      role="dialog" aria-label={label} data-date-picker="true" data-escape-boundary="true"
      onClick={(event) => event.stopPropagation()}
      onFocusCapture={() => {
        if (blurFrame.current != null) cancelAnimationFrame(blurFrame.current);
        blurFrame.current = null;
      }}
      onBlurCapture={(event) => {
        if (blurFrame.current != null) cancelAnimationFrame(blurFrame.current);
        const next = event.relatedTarget as Node | null;
        if (next) closeWhenFocusLeaves(next);
        else blurFrame.current = requestAnimationFrame(() => {
          blurFrame.current = null;
          closeWhenFocusLeaves(document.activeElement);
        });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onDismiss(); }
        if (event.key === 'Enter') event.stopPropagation();
      }}>
      <header><strong>Chọn ngày</strong><button type="button" aria-label="Đóng lịch" onClick={onDismiss}><X size={14} aria-hidden="true" /></button></header>
      <DatePanel value={value} min={min} max={max} onChange={onPick} />
    </div>, document.body,
  );
}
