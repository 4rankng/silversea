import { useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { usePopoverPosition } from '../../../hooks/usePopoverPosition';
import './FactoryDetailPopover.css';

export interface FactoryInvoiceGroup {
  label: string;
  lines: Array<{ label: string; value: string }>;
}

interface FactoryDetailPopoverProps {
  name: string;
  address: string;
  invoiceGroups: FactoryInvoiceGroup[];
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
}

/** Read-only peek at a selected factory's address and invoice info, anchored
 *  to the container row's factory cell. Never stretches the row: the panel
 *  portals to body and positions against the trigger. */
export function FactoryDetailPopover({
  name,
  address,
  invoiceGroups,
  anchorRef,
  open,
  onClose,
}: FactoryDetailPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const position = usePopoverPosition(popoverRef, anchorRef, open, 320, 240);
  useClickOutside(popoverRef, onClose, { enabled: open, escapeKey: true, additionalRefs: [anchorRef] });

  if (!open || !position) return null;
  return createPortal(
    <div
      ref={popoverRef}
      className="factory-detail-pop"
      role="dialog"
      aria-label={`Chi tiết nhà máy ${name}`}
      style={{ top: position.top, left: position.left, ...(position.maxHeight != null ? { maxHeight: position.maxHeight } : {}) }}
    >
      <p className="factory-detail-pop__head">
        <span className="factory-detail-pop__name">{name}</span>
        <button
          type="button"
          className="factory-detail-pop__close"
          aria-label="Đóng"
          onClick={onClose}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </p>
      <p className="factory-detail-pop__address">{address}</p>
      {invoiceGroups.map((group) => (
        <div key={group.label} className="factory-detail-pop__group">
          <p className="factory-detail-pop__group-label">{group.label}</p>
          {group.lines.map((line) => (
            <p key={line.label} className="factory-detail-pop__line">
              <span className="factory-detail-pop__line-label">{line.label}</span> {line.value}
            </p>
          ))}
        </div>
      ))}
    </div>,
    document.body,
  );
}
